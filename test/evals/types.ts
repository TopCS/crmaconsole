export type EvalEvent = {
  type: string;
  globalSeq?: number;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  text?: string;
  output?: Record<string, unknown>;
  errorText?: string;
  sessionKey?: string;
};

export type TrajectoryMatchMode = "strict" | "subset" | "superset" | "unordered";

export type EvalCase = {
  id: string;
  description: string;
  critical?: boolean;
  events: EvalEvent[];
  expectations: {
    output?: {
      mustContain?: string[];
      mustNotContain?: string[];
    };
    trajectory?: {
      tools: string[];
      mode: TrajectoryMatchMode;
    };
    trace?: {
      requiredTypes?: string[];
      requireMonotonicGlobalSeq?: boolean;
    };
  };
};

export type GradeResult = {
  grader: "output" | "trajectory" | "trace";
  passed: boolean;
  details: string[];
};

export type CaseEvaluation = {
  testCase: EvalCase;
  results: GradeResult[];
  passed: boolean;
};
