-- CreateEnum
CREATE TYPE "OrgUnitType" AS ENUM ('ENTITY', 'DIRECTION', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "AuthProviderKind" AS ENUM ('LOCAL', 'OIDC');

-- CreateEnum
CREATE TYPE "AiSystemStatus" AS ENUM ('DRAFT', 'QUALIFICATION', 'VALIDATION', 'PILOT', 'ACTIVE', 'SUSPENDED', 'RETIRED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiActRole" AS ENUM ('PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR', 'AUTHORISED_REPRESENTATIVE', 'PRODUCT_MANUFACTURER', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskDisplayCategory" AS ENUM ('OUT_OF_SCOPE', 'MINIMAL', 'LIMITED', 'HIGH', 'PROHIBITED', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "ValueLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('NOT_ASSESSED', 'NON_COMPLIANT', 'PARTIAL', 'COMPLIANT');

-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('ASSISTIVE', 'HUMAN_IN_THE_LOOP', 'HUMAN_ON_THE_LOOP', 'AUTONOMOUS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TriState" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "StakeholderKind" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PartyFunction" AS ENUM ('SPONSOR', 'BUSINESS_OWNER', 'IT_LEAD', 'CISO', 'DPO_LEGAL', 'VENDOR_CONTACT', 'INTEGRATOR', 'USER_REPRESENTATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "Raci" AS ENUM ('RESPONSIBLE', 'ACCOUNTABLE', 'CONSULTED', 'INFORMED');

-- CreateEnum
CREATE TYPE "VendorRelation" AS ENUM ('PROVIDER', 'INTEGRATOR', 'HOSTING', 'RESELLER', 'OTHER');

-- CreateEnum
CREATE TYPE "ModelType" AS ENUM ('LLM', 'VISION', 'CLASSIFICATION', 'RECOMMENDATION', 'SPEECH', 'MULTIMODAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ModelAccessMode" AS ENUM ('API', 'SAAS', 'ON_PREMISE', 'OPEN_WEIGHTS', 'EMBEDDED', 'OTHER');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('UNDER_EVALUATION', 'APPROVED', 'DEPRECATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('APPLICATION', 'API', 'SERVER', 'SAAS', 'DATABASE', 'DEVICE', 'INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "DatasetOrigin" AS ENUM ('INTERNAL', 'VENDOR', 'PUBLIC', 'PURCHASED', 'SYNTHETIC', 'OTHER');

-- CreateEnum
CREATE TYPE "DatasetUsage" AS ENUM ('TRAINING', 'FINE_TUNING', 'RAG', 'INFERENCE', 'VALIDATION', 'TESTING');

-- CreateEnum
CREATE TYPE "GdprRole" AS ENUM ('CONTROLLER', 'JOINT_CONTROLLER', 'PROCESSOR');

-- CreateEnum
CREATE TYPE "FrameworkStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'COMPLETED', 'VALIDATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "Origin" AS ENUM ('USER', 'IMPORT', 'API', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Applicability" AS ENUM ('YES', 'NO', 'TO_CONFIRM');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ObligationCategory" AS ENUM ('GOVERNANCE_RISK', 'DATA_GOVERNANCE', 'DOCUMENTATION', 'LOGGING', 'TRANSPARENCY', 'HUMAN_OVERSIGHT', 'ACCURACY_ROBUSTNESS_SECURITY', 'DEPLOYER', 'WORKER_INFORMATION', 'FRIA', 'DPIA', 'MONITORING_INCIDENTS', 'AI_LITERACY', 'PROHIBITION', 'REGISTRATION', 'GPAI', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('FUNDAMENTAL_RIGHTS', 'PRIVACY', 'BIAS_DISCRIMINATION', 'SECURITY', 'HALLUCINATION_ACCURACY', 'CONFIDENTIALITY', 'INTELLECTUAL_PROPERTY', 'VENDOR_DEPENDENCY', 'TRANSPARENCY', 'HUMAN_OVERSIGHT', 'ROBUSTNESS', 'REPUTATION', 'BUSINESS_CONTINUITY');

-- CreateEnum
CREATE TYPE "RiskTreatment" AS ENUM ('REDUCE', 'ACCEPT', 'TRANSFER', 'AVOID');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('IDENTIFIED', 'ASSESSED', 'IN_TREATMENT', 'ACCEPTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MeasureType" AS ENUM ('PREVENTIVE', 'DETECTIVE', 'CORRECTIVE', 'ORGANISATIONAL', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "MeasureStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'VALIDATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('TRANSPARENCY_NOTICE', 'CONTRACT', 'DPA', 'VENDOR_DOCUMENTATION', 'DPIA', 'FRIA', 'SECURITY_ANALYSIS', 'TEST_REPORT', 'VALIDATION_RECORD', 'USER_INSTRUCTIONS', 'LOGS', 'CERTIFICATE', 'COMPLIANCE_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('NOT_SCANNED', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ApprovalDomain" AS ENUM ('BUSINESS', 'DPO', 'RSSI', 'LEGAL', 'IT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('PERIODIC', 'EXCEPTIONAL');

-- CreateEnum
CREATE TYPE "ReviewTrigger" AS ENUM ('SCHEDULED', 'MAJOR_CHANGE', 'INCIDENT', 'MODEL_CHANGE', 'PURPOSE_CHANGE', 'DATASET_CHANGE', 'VENDOR_CHANGE', 'POPULATION_CHANGE', 'AUTONOMY_CHANGE', 'REGULATORY_CHANGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('TO_VERIFY', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "organization_unit" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgUnitType" NOT NULL,
    "parentId" UUID,
    "path" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "organization_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "authProvider" "AuthProviderKind" NOT NULL DEFAULT 'LOCAL',
    "externalId" TEXT,
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "orgUnitId" UUID,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_assignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "orgUnitId" UUID,
    "includeDescendants" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "user_role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT '',
    "objectives" TEXT NOT NULL DEFAULT '',
    "useCases" TEXT NOT NULL DEFAULT '',
    "functioning" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "operationalContext" TEXT NOT NULL DEFAULT '',
    "countries" TEXT[],
    "targetPopulations" TEXT NOT NULL DEFAULT '',
    "status" "AiSystemStatus" NOT NULL DEFAULT 'DRAFT',
    "autonomyLevel" "AutonomyLevel" NOT NULL DEFAULT 'UNKNOWN',
    "aiActRoles" "AiActRole"[],
    "orgUnitId" UUID NOT NULL,
    "ownerId" UUID,
    "businessOwnerId" UUID,
    "raciEnabled" BOOLEAN NOT NULL DEFAULT false,
    "firstDeploymentDate" DATE,
    "productionDate" DATE,
    "plannedRetirementDate" DATE,
    "actualRetirementDate" DATE,
    "nextReviewDate" DATE,
    "processesPersonalData" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "includesMinors" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "includesVulnerable" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "affectedVolumeEstimate" TEXT NOT NULL DEFAULT '',
    "potentialConsequences" TEXT NOT NULL DEFAULT '',
    "valueLevel" "ValueLevel" NOT NULL DEFAULT 'UNKNOWN',
    "valueJustification" TEXT NOT NULL DEFAULT '',
    "valueDetails" JSONB NOT NULL DEFAULT '{}',
    "riskCategory" "RiskDisplayCategory" NOT NULL DEFAULT 'UNDETERMINED',
    "riskJustification" TEXT NOT NULL DEFAULT '',
    "currentAssessmentId" UUID,
    "complianceStatus" "ComplianceStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "sectionsState" JSONB NOT NULL DEFAULT '{}',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedById" UUID,
    "archiveReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lockedVersion" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ai_system_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "system_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_assignment" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "section_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_tag" (
    "aiSystemId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "ai_system_tag_pkey" PRIMARY KEY ("aiSystemId","tagId")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "dpaSigned" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_vendor" (
    "aiSystemId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "relation" "VendorRelation" NOT NULL DEFAULT 'PROVIDER',
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_system_vendor_pkey" PRIMARY KEY ("aiSystemId","vendorId","relation")
);

-- CreateTable
CREATE TABLE "ai_model" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vendorId" UUID,
    "family" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "type" "ModelType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "capabilities" TEXT NOT NULL DEFAULT '',
    "knownLimitations" TEXT NOT NULL DEFAULT '',
    "accessMode" "ModelAccessMode" NOT NULL,
    "hosting" TEXT NOT NULL DEFAULT '',
    "regions" TEXT[],
    "documentationUrl" TEXT NOT NULL DEFAULT '',
    "knowledgeDate" DATE,
    "versionDate" DATE,
    "status" "ModelStatus" NOT NULL DEFAULT 'UNDER_EVALUATION',
    "isGpai" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "gpaiSystemicRisk" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "gpaiNotes" TEXT NOT NULL DEFAULT '',
    "license" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ai_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_model" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "aiModelId" UUID NOT NULL,
    "usageDescription" TEXT NOT NULL,
    "versionUsed" TEXT NOT NULL DEFAULT '',
    "hostingMode" "ModelAccessMode",
    "integrationDate" DATE,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ai_system_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stakeholder" (
    "id" UUID NOT NULL,
    "kind" "StakeholderKind" NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "userId" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "stakeholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_stakeholder" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "stakeholderId" UUID NOT NULL,
    "function" "PartyFunction" NOT NULL,
    "responsibility" TEXT NOT NULL DEFAULT '',
    "access" TEXT NOT NULL DEFAULT '',
    "raci" "Raci",

    CONSTRAINT "ai_system_stakeholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "vendorId" UUID,
    "criticality" "Priority",
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_asset" (
    "aiSystemId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "dependency" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_system_asset_pkey" PRIMARY KEY ("aiSystemId","assetId")
);

-- CreateTable
CREATE TABLE "data_category" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isSpecial" BOOLEAN NOT NULL DEFAULT false,
    "isCriminal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "data_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_category" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isVulnerable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "data_subject_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_activity" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "legalBasis" TEXT NOT NULL DEFAULT '',
    "gdprRole" "GdprRole" NOT NULL DEFAULT 'CONTROLLER',
    "dpiaRequired" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "retention" TEXT NOT NULL DEFAULT '',
    "externalRef" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "processing_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_activity_data_category" (
    "processingActivityId" UUID NOT NULL,
    "dataCategoryId" UUID NOT NULL,

    CONSTRAINT "processing_activity_data_category_pkey" PRIMARY KEY ("processingActivityId","dataCategoryId")
);

-- CreateTable
CREATE TABLE "processing_activity_data_subject" (
    "processingActivityId" UUID NOT NULL,
    "dataSubjectId" UUID NOT NULL,

    CONSTRAINT "processing_activity_data_subject_pkey" PRIMARY KEY ("processingActivityId","dataSubjectId")
);

-- CreateTable
CREATE TABLE "ai_system_processing_activity" (
    "aiSystemId" UUID NOT NULL,
    "processingActivityId" UUID NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ai_system_processing_activity_pkey" PRIMARY KEY ("aiSystemId","processingActivityId")
);

-- CreateTable
CREATE TABLE "dataset" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "origin" "DatasetOrigin" NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT '',
    "containsPersonalData" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "containsSpecialCategories" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "containsCriminalData" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "provenance" TEXT NOT NULL DEFAULT '',
    "license" TEXT NOT NULL DEFAULT '',
    "qualityNotes" TEXT NOT NULL DEFAULT '',
    "representativenessNotes" TEXT NOT NULL DEFAULT '',
    "retention" TEXT NOT NULL DEFAULT '',
    "storageLocation" TEXT NOT NULL DEFAULT '',
    "transfersOutsideEu" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "recipients" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_dataset" (
    "aiSystemId" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "usages" "DatasetUsage"[],
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_system_dataset_pkey" PRIMARY KEY ("aiSystemId","datasetId")
);

-- CreateTable
CREATE TABLE "ai_system_data_category" (
    "aiSystemId" UUID NOT NULL,
    "dataCategoryId" UUID NOT NULL,

    CONSTRAINT "ai_system_data_category_pkey" PRIMARY KEY ("aiSystemId","dataCategoryId")
);

-- CreateTable
CREATE TABLE "ai_system_data_subject" (
    "aiSystemId" UUID NOT NULL,
    "dataSubjectId" UUID NOT NULL,
    "volumeEstimate" TEXT NOT NULL DEFAULT '',
    "consequences" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_system_data_subject_pkey" PRIMARY KEY ("aiSystemId","dataSubjectId")
);

-- CreateTable
CREATE TABLE "regulatory_framework" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "FrameworkStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "content" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" UUID,

    CONSTRAINT "regulatory_framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_act_assessment" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "frameworkId" UUID NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "Origin" NOT NULL DEFAULT 'USER',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "computedResult" JSONB,
    "computedCategory" "RiskDisplayCategory",
    "effectiveCategory" "RiskDisplayCategory",
    "computedAt" TIMESTAMP(3),
    "computedById" UUID,
    "validatedAt" TIMESTAMP(3),
    "validatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ai_act_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_override" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "dimension" TEXT NOT NULL,
    "previousValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "justification" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" "ObligationCategory" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "assessmentId" UUID,
    "templateKey" TEXT NOT NULL,
    "frameworkVersion" TEXT NOT NULL,
    "sourceRuleIds" TEXT[],
    "legalBasis" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ObligationCategory" NOT NULL,
    "applicability" "Applicability" NOT NULL DEFAULT 'TO_CONFIRM',
    "status" "ObligationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "responsibleId" UUID,
    "targetDate" DATE,
    "validatedAt" TIMESTAMP(3),
    "validatedById" UUID,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_control" (
    "obligationId" UUID NOT NULL,
    "controlId" UUID NOT NULL,

    CONSTRAINT "obligation_control_pkey" PRIMARY KEY ("obligationId","controlId")
);

-- CreateTable
CREATE TABLE "risk_methodology" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "risk_methodology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "methodologyId" UUID NOT NULL,
    "category" "RiskCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL DEFAULT '',
    "cause" TEXT NOT NULL DEFAULT '',
    "event" TEXT NOT NULL DEFAULT '',
    "consequence" TEXT NOT NULL DEFAULT '',
    "inherentLikelihood" INTEGER,
    "inherentSeverity" INTEGER,
    "inherentScore" INTEGER,
    "residualLikelihood" INTEGER,
    "residualSeverity" INTEGER,
    "residualScore" INTEGER,
    "treatment" "RiskTreatment",
    "treatmentPlan" TEXT NOT NULL DEFAULT '',
    "status" "RiskStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "ownerId" UUID,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measure" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "MeasureType" NOT NULL,
    "status" "MeasureStatus" NOT NULL DEFAULT 'PLANNED',
    "ownerId" UUID,
    "controlId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_measure" (
    "riskId" UUID NOT NULL,
    "measureId" UUID NOT NULL,
    "isExisting" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "risk_measure_pkey" PRIMARY KEY ("riskId","measureId")
);

-- CreateTable
CREATE TABLE "action" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" UUID,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "aiSystemId" UUID,
    "riskId" UUID,
    "obligationId" UUID,
    "measureId" UUID,
    "origin" "Origin" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fria" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "sections" JSONB NOT NULL DEFAULT '{}',
    "dpiaId" UUID,
    "coveredByDpia" TEXT[],
    "conclusion" TEXT NOT NULL DEFAULT '',
    "validatedAt" TIMESTAMP(3),
    "validatedById" UUID,
    "notifiedAuthorityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "fria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpia" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "aiSystemId" UUID,
    "processingActivityId" UUID,
    "status" "WorkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "conductedOn" DATE,
    "conclusion" TEXT NOT NULL DEFAULT '',
    "coveredTopics" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "dpia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transparency_notice" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "origin" "Origin" NOT NULL DEFAULT 'USER',
    "blocks" TEXT[],
    "contentMarkdown" TEXT NOT NULL DEFAULT '',
    "sourceSnapshot" JSONB,
    "validatedAt" TIMESTAMP(3),
    "validatedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "transparency_notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "currentVersionNo" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "changeNote" TEXT NOT NULL DEFAULT '',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" UUID NOT NULL,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_document" (
    "aiSystemId" UUID NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "ai_system_document_pkey" PRIMARY KEY ("aiSystemId","documentId")
);

-- CreateTable
CREATE TABLE "ai_model_document" (
    "aiModelId" UUID NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "ai_model_document_pkey" PRIMARY KEY ("aiModelId","documentId")
);

-- CreateTable
CREATE TABLE "obligation_evidence" (
    "obligationId" UUID NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "obligation_evidence_pkey" PRIMARY KEY ("obligationId","documentId")
);

-- CreateTable
CREATE TABLE "risk_evidence" (
    "riskId" UUID NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "risk_evidence_pkey" PRIMARY KEY ("riskId","documentId")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "entityVersion" INTEGER NOT NULL,
    "domain" "ApprovalDomain" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "approverId" UUID,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "aiSystemId" UUID NOT NULL,
    "kind" "ReviewKind" NOT NULL,
    "trigger" "ReviewTrigger" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PLANNED',
    "dueDate" DATE NOT NULL,
    "reviewerId" UUID,
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "aiSystemId" UUID,
    "section" TEXT,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "authorId" UUID NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_view" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "origin" "Origin" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "aiSystemId" UUID,
    "changes" JSONB,
    "justification" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_version" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "entity_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_suggestion" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "field" TEXT NOT NULL,
    "proposedValue" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "uncertainty" TEXT NOT NULL DEFAULT '',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'TO_VERIFY',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,

    CONSTRAINT "assistant_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_unit_code_key" ON "organization_unit"("code");

-- CreateIndex
CREATE INDEX "organization_unit_parentId_idx" ON "organization_unit"("parentId");

-- CreateIndex
CREATE INDEX "organization_unit_path_idx" ON "organization_unit"("path");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_externalId_key" ON "app_user"("externalId");

-- CreateIndex
CREATE INDEX "app_user_orgUnitId_idx" ON "app_user"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "role_key_key" ON "role"("key");

-- CreateIndex
CREATE INDEX "user_role_assignment_userId_idx" ON "user_role_assignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_assignment_userId_roleId_orgUnitId_key" ON "user_role_assignment"("userId", "roleId", "orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "session_tokenHash_key" ON "session"("tokenHash");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_reference_key" ON "ai_system"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_currentAssessmentId_key" ON "ai_system"("currentAssessmentId");

-- CreateIndex
CREATE INDEX "ai_system_orgUnitId_idx" ON "ai_system"("orgUnitId");

-- CreateIndex
CREATE INDEX "ai_system_ownerId_idx" ON "ai_system"("ownerId");

-- CreateIndex
CREATE INDEX "ai_system_status_idx" ON "ai_system"("status");

-- CreateIndex
CREATE INDEX "ai_system_riskCategory_idx" ON "ai_system"("riskCategory");

-- CreateIndex
CREATE INDEX "ai_system_valueLevel_idx" ON "ai_system"("valueLevel");

-- CreateIndex
CREATE INDEX "ai_system_nextReviewDate_idx" ON "ai_system"("nextReviewDate");

-- CreateIndex
CREATE INDEX "ai_system_archivedAt_idx" ON "ai_system"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "system_template_name_key" ON "system_template"("name");

-- CreateIndex
CREATE INDEX "section_assignment_userId_idx" ON "section_assignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "section_assignment_aiSystemId_section_userId_key" ON "section_assignment"("aiSystemId", "section", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tag_label_key" ON "tag"("label");

-- CreateIndex
CREATE INDEX "ai_system_tag_tagId_idx" ON "ai_system_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_name_key" ON "vendor"("name");

-- CreateIndex
CREATE INDEX "ai_system_vendor_vendorId_idx" ON "ai_system_vendor"("vendorId");

-- CreateIndex
CREATE INDEX "ai_model_vendorId_idx" ON "ai_model"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_name_version_vendorId_key" ON "ai_model"("name", "version", "vendorId");

-- CreateIndex
CREATE INDEX "ai_system_model_aiModelId_idx" ON "ai_system_model"("aiModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_model_aiSystemId_aiModelId_versionUsed_key" ON "ai_system_model"("aiSystemId", "aiModelId", "versionUsed");

-- CreateIndex
CREATE INDEX "stakeholder_userId_idx" ON "stakeholder"("userId");

-- CreateIndex
CREATE INDEX "ai_system_stakeholder_stakeholderId_idx" ON "ai_system_stakeholder"("stakeholderId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_stakeholder_aiSystemId_stakeholderId_function_key" ON "ai_system_stakeholder"("aiSystemId", "stakeholderId", "function");

-- CreateIndex
CREATE INDEX "asset_type_idx" ON "asset"("type");

-- CreateIndex
CREATE INDEX "ai_system_asset_assetId_idx" ON "ai_system_asset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "data_category_key_key" ON "data_category"("key");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_category_key_key" ON "data_subject_category"("key");

-- CreateIndex
CREATE UNIQUE INDEX "processing_activity_reference_key" ON "processing_activity"("reference");

-- CreateIndex
CREATE INDEX "ai_system_processing_activity_processingActivityId_idx" ON "ai_system_processing_activity"("processingActivityId");

-- CreateIndex
CREATE INDEX "ai_system_dataset_datasetId_idx" ON "ai_system_dataset"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_framework_key_version_key" ON "regulatory_framework"("key", "version");

-- CreateIndex
CREATE INDEX "ai_act_assessment_aiSystemId_idx" ON "ai_act_assessment"("aiSystemId");

-- CreateIndex
CREATE INDEX "assessment_override_assessmentId_idx" ON "assessment_override"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "control_key_key" ON "control"("key");

-- CreateIndex
CREATE INDEX "obligation_status_idx" ON "obligation"("status");

-- CreateIndex
CREATE INDEX "obligation_responsibleId_idx" ON "obligation"("responsibleId");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_aiSystemId_templateKey_key" ON "obligation"("aiSystemId", "templateKey");

-- CreateIndex
CREATE UNIQUE INDEX "risk_methodology_name_version_key" ON "risk_methodology"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "risk_reference_key" ON "risk"("reference");

-- CreateIndex
CREATE INDEX "risk_aiSystemId_idx" ON "risk"("aiSystemId");

-- CreateIndex
CREATE INDEX "risk_residualScore_idx" ON "risk"("residualScore");

-- CreateIndex
CREATE INDEX "risk_status_idx" ON "risk"("status");

-- CreateIndex
CREATE INDEX "action_aiSystemId_idx" ON "action"("aiSystemId");

-- CreateIndex
CREATE INDEX "action_assigneeId_idx" ON "action"("assigneeId");

-- CreateIndex
CREATE INDEX "action_status_dueDate_idx" ON "action"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fria_aiSystemId_version_key" ON "fria"("aiSystemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "dpia_reference_key" ON "dpia"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transparency_notice_aiSystemId_language_version_key" ON "transparency_notice"("aiSystemId", "language", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_storageKey_key" ON "document_version"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_documentId_versionNo_key" ON "document_version"("documentId", "versionNo");

-- CreateIndex
CREATE INDEX "approval_aiSystemId_idx" ON "approval"("aiSystemId");

-- CreateIndex
CREATE INDEX "approval_approverId_status_idx" ON "approval"("approverId", "status");

-- CreateIndex
CREATE INDEX "review_aiSystemId_idx" ON "review"("aiSystemId");

-- CreateIndex
CREATE INDEX "review_status_dueDate_idx" ON "review"("status", "dueDate");

-- CreateIndex
CREATE INDEX "comment_entityType_entityId_idx" ON "comment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "comment_aiSystemId_idx" ON "comment"("aiSystemId");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_view_userId_scope_name_key" ON "saved_view"("userId", "scope", "name");

-- CreateIndex
CREATE INDEX "audit_event_entityType_entityId_idx" ON "audit_event"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_event_aiSystemId_idx" ON "audit_event"("aiSystemId");

-- CreateIndex
CREATE INDEX "audit_event_actorId_idx" ON "audit_event"("actorId");

-- CreateIndex
CREATE INDEX "audit_event_occurredAt_idx" ON "audit_event"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "entity_version_entityType_entityId_version_key" ON "entity_version"("entityType", "entityId", "version");

-- CreateIndex
CREATE INDEX "assistant_suggestion_entityType_entityId_status_idx" ON "assistant_suggestion"("entityType", "entityId", "status");

-- AddForeignKey
ALTER TABLE "organization_unit" ADD CONSTRAINT "organization_unit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organization_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "organization_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "organization_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system" ADD CONSTRAINT "ai_system_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "organization_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system" ADD CONSTRAINT "ai_system_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system" ADD CONSTRAINT "ai_system_businessOwnerId_fkey" FOREIGN KEY ("businessOwnerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_assignment" ADD CONSTRAINT "section_assignment_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_assignment" ADD CONSTRAINT "section_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_tag" ADD CONSTRAINT "ai_system_tag_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_tag" ADD CONSTRAINT "ai_system_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_vendor" ADD CONSTRAINT "ai_system_vendor_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_vendor" ADD CONSTRAINT "ai_system_vendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_model" ADD CONSTRAINT "ai_system_model_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_model" ADD CONSTRAINT "ai_system_model_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "ai_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_stakeholder" ADD CONSTRAINT "ai_system_stakeholder_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_stakeholder" ADD CONSTRAINT "ai_system_stakeholder_stakeholderId_fkey" FOREIGN KEY ("stakeholderId") REFERENCES "stakeholder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_asset" ADD CONSTRAINT "ai_system_asset_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_asset" ADD CONSTRAINT "ai_system_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_activity_data_category" ADD CONSTRAINT "processing_activity_data_category_processingActivityId_fkey" FOREIGN KEY ("processingActivityId") REFERENCES "processing_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_activity_data_category" ADD CONSTRAINT "processing_activity_data_category_dataCategoryId_fkey" FOREIGN KEY ("dataCategoryId") REFERENCES "data_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_activity_data_subject" ADD CONSTRAINT "processing_activity_data_subject_processingActivityId_fkey" FOREIGN KEY ("processingActivityId") REFERENCES "processing_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_activity_data_subject" ADD CONSTRAINT "processing_activity_data_subject_dataSubjectId_fkey" FOREIGN KEY ("dataSubjectId") REFERENCES "data_subject_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_processing_activity" ADD CONSTRAINT "ai_system_processing_activity_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_processing_activity" ADD CONSTRAINT "ai_system_processing_activity_processingActivityId_fkey" FOREIGN KEY ("processingActivityId") REFERENCES "processing_activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_dataset" ADD CONSTRAINT "ai_system_dataset_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_dataset" ADD CONSTRAINT "ai_system_dataset_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_data_category" ADD CONSTRAINT "ai_system_data_category_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_data_category" ADD CONSTRAINT "ai_system_data_category_dataCategoryId_fkey" FOREIGN KEY ("dataCategoryId") REFERENCES "data_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_data_subject" ADD CONSTRAINT "ai_system_data_subject_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_data_subject" ADD CONSTRAINT "ai_system_data_subject_dataSubjectId_fkey" FOREIGN KEY ("dataSubjectId") REFERENCES "data_subject_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_act_assessment" ADD CONSTRAINT "ai_act_assessment_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_act_assessment" ADD CONSTRAINT "ai_act_assessment_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "regulatory_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_override" ADD CONSTRAINT "assessment_override_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ai_act_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ai_act_assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_control" ADD CONSTRAINT "obligation_control_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_control" ADD CONSTRAINT "obligation_control_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk" ADD CONSTRAINT "risk_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk" ADD CONSTRAINT "risk_methodologyId_fkey" FOREIGN KEY ("methodologyId") REFERENCES "risk_methodology"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure" ADD CONSTRAINT "measure_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "control"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_measure" ADD CONSTRAINT "risk_measure_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_measure" ADD CONSTRAINT "risk_measure_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "measure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fria" ADD CONSTRAINT "fria_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fria" ADD CONSTRAINT "fria_dpiaId_fkey" FOREIGN KEY ("dpiaId") REFERENCES "dpia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpia" ADD CONSTRAINT "dpia_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpia" ADD CONSTRAINT "dpia_processingActivityId_fkey" FOREIGN KEY ("processingActivityId") REFERENCES "processing_activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transparency_notice" ADD CONSTRAINT "transparency_notice_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_document" ADD CONSTRAINT "ai_system_document_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_document" ADD CONSTRAINT "ai_system_document_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_document" ADD CONSTRAINT "ai_model_document_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "ai_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_document" ADD CONSTRAINT "ai_model_document_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_evidence" ADD CONSTRAINT "obligation_evidence_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_evidence" ADD CONSTRAINT "obligation_evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_evidence" ADD CONSTRAINT "risk_evidence_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_evidence" ADD CONSTRAINT "risk_evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Journal d'audit immuable (ajout manuel) : toute modification ou suppression
-- d'un événement est rejetée, y compris TRUNCATE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chandelier_audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event est immuable (opération % refusée)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION chandelier_audit_event_immutable();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION chandelier_audit_event_immutable();

-- Même protection pour les surcharges juristes et les instantanés de version.
CREATE TRIGGER assessment_override_no_update_delete
  BEFORE UPDATE OR DELETE ON "assessment_override"
  FOR EACH ROW EXECUTE FUNCTION chandelier_audit_event_immutable();

CREATE TRIGGER entity_version_no_update_delete
  BEFORE UPDATE OR DELETE ON "entity_version"
  FOR EACH ROW EXECUTE FUNCTION chandelier_audit_event_immutable();
