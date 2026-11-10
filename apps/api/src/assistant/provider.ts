import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { AppError } from '../errors.js';

/**
 * Abstraction de fournisseur LLM (CDC §10) : le métier ne dépend que de cette interface.
 * Aucun fournisseur n'est actif par défaut (LLM_PROVIDER=disabled) ; la clé n'est jamais exposée au frontend.
 */
export interface LlmRequest<T> {
  /** Consignes de la tâche (stables). */
  instructions: string;
  /** Données transmises, déjà minimisées par l'appelant. */
  input: string;
  /** Schéma JSON de la réponse attendue et validation zod côté serveur. */
  jsonSchema: Record<string, unknown>;
  parse: z.ZodType<T>;
}
export interface LlmResult<T> {
  data: T;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly enabled: boolean;
  generate<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export const disabledProvider: LlmProvider = {
  name: 'disabled',
  model: '',
  enabled: false,
  generate() {
    return Promise.reject(
      new AppError(503, 'ASSISTANT_DISABLED', 'Assistant IA désactivé sur cette instance (LLM_PROVIDER=disabled)'),
    );
  },
};

/** Fournisseur Anthropic (API Claude) via le SDK officiel ; sortie structurée JSON validée côté serveur. */
export function anthropicProvider(apiKey: string, model: string): LlmProvider {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  return {
    name: 'anthropic',
    model,
    enabled: true,
    async generate<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          // En cas de refus par les garde-fous, l'API rejoue la requête sur un modèle de repli.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: req.instructions,
          output_config: { format: { type: 'json_schema', schema: req.jsonSchema } },
          messages: [{ role: 'user', content: req.input }],
        });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError)
          throw new AppError(429, 'LLM_RATE_LIMIT', 'Fournisseur IA saturé : réessayez plus tard');
        if (e instanceof Anthropic.AuthenticationError)
          throw new AppError(502, 'LLM_AUTH', 'Clé du fournisseur IA refusée (configuration)');
        if (e instanceof Anthropic.APIError)
          throw new AppError(502, 'LLM_ERROR', `Fournisseur IA indisponible (${e.status ?? 'réseau'})`);
        throw e;
      }
      if (response.stop_reason === 'refusal')
        throw new AppError(422, 'LLM_REFUSAL', 'Le modèle a refusé de traiter cette demande');
      if (response.stop_reason === 'max_tokens')
        throw new AppError(502, 'LLM_TRUNCATED', 'Réponse du modèle incomplète : réduisez le texte transmis');
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AppError(502, 'LLM_INVALID', 'Réponse du modèle illisible');
      }
      const parsed = req.parse.safeParse(json);
      if (!parsed.success) throw new AppError(502, 'LLM_INVALID', 'Réponse du modèle non conforme au format attendu');
      return {
        data: parsed.data,
        provider: 'anthropic',
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
