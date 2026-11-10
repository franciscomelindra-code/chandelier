import { inlineSegments, parseMarkdown } from '@chandelier/shared';

/** Rendu d'un sous-ensemble Markdown sans HTML brut (aucun dangerouslySetInnerHTML). */
export function Markdown({ source }: { source: string }) {
  const inline = (t: string) =>
    inlineSegments(t).map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>));
  const mark = (t: string) =>
    t.split(/(\[À compléter[^\]]*\])/g).map((part, i) =>
      part.startsWith('[À compléter') ? (
        <mark key={i} className="rounded bg-tone-yellow-bg px-1 text-tone-yellow-fg">
          {part}
        </mark>
      ) : (
        <span key={i}>{inline(part)}</span>
      ),
    );
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parseMarkdown(source).map((b, i) => {
        switch (b.kind) {
          case 'h1':
            return (
              <h3 key={i} className="text-lg font-extrabold text-gls-blue">
                {mark(b.text)}
              </h3>
            );
          case 'h2':
          case 'h3':
            return (
              <h4 key={i} className="mt-3 font-bold text-gls-blue">
                {mark(b.text)}
              </h4>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{mark(it)}</li>
                ))}
              </ul>
            );
          case 'hr':
            return <hr key={i} className="border-grey-200" />;
          default:
            return <p key={i}>{mark(b.text)}</p>;
        }
      })}
    </div>
  );
}
