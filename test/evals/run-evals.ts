import { chatAgentEvalDataset } from "./dataset.js";
import { gradeOutput, gradeTraceIntegrity, gradeTrajectory } from "./graders.js";
import type { CaseEvaluation } from "./types.js";

function evaluateDataset(): CaseEvaluation[] {
  return chatAgentEvalDataset.map((testCase) => {
    const results = [
      gradeOutput(testCase),
      gradeTrajectory(testCase),
      gradeTraceIntegrity(testCase),
    ];
    const passed = results.every((result) => result.passed);
    return { testCase, results, passed };
  });
}

function printHumanSummary(evaluations: CaseEvaluation[]) {
  let totalGraders = 0;
  let passedGraders = 0;

  for (const evaluation of evaluations) {
    for (const result of evaluation.results) {
      totalGraders += 1;
      if (result.passed) {
        passedGraders += 1;
      }
    }
  }

  // Keep output friendly for CI logs.
  console.log("LLM eval summary");
  console.log(`- cases: ${evaluations.length}`);
  console.log(`- graders passed: ${passedGraders}/${totalGraders}`);

  for (const evaluation of evaluations) {
    const status = evaluation.passed ? "PASS" : "FAIL";
    const critical = evaluation.testCase.critical ? "critical" : "non-critical";
    console.log(`\n[${status}] ${evaluation.testCase.id} (${critical})`);
    console.log(`  ${evaluation.testCase.description}`);
    for (const result of evaluation.results) {
      const marker = result.passed ? "ok" : "x";
      console.log(`  - ${marker} ${result.grader}`);
      for (const detail of result.details) {
        console.log(`    · ${detail}`);
      }
    }
  }
}

function printJsonSummary(evaluations: CaseEvaluation[]) {
  const payload = {
    generatedAt: new Date().toISOString(),
    totalCases: evaluations.length,
    evaluations: evaluations.map((evaluation) => ({
      id: evaluation.testCase.id,
      description: evaluation.testCase.description,
      critical: Boolean(evaluation.testCase.critical),
      passed: evaluation.passed,
      results: evaluation.results,
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
}

const evaluations = evaluateDataset();
const hasCriticalFailure = evaluations.some(
  (evaluation) => Boolean(evaluation.testCase.critical) && !evaluation.passed,
);
const enforce = process.env.EVALS_ENFORCE === "1";
const emitJson = process.argv.includes("--json");

if (emitJson) {
  printJsonSummary(evaluations);
} else {
  printHumanSummary(evaluations);
}

if (enforce && hasCriticalFailure) {
  console.error("\nCritical eval checks failed with EVALS_ENFORCE=1.");
  process.exit(1);
}
