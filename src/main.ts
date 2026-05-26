import * as fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import * as exec from "@actions/exec";
import {
  detectLayout,
  flatten,
  listTranslationUnits,
  missingKeys,
  readJson,
  setByPath,
  writeJson,
  type JsonObject,
} from "./locales.js";
import { translateBatch } from "./translate.js";

async function run(): Promise<void> {
  const sourceLocale = core.getInput("source-locale") || "en";
  const localesDir = core.getInput("locales-dir") || "locales";
  const apiKey = core.getInput("api-key", { required: true });
  const model = core.getInput("model") || "gpt-4o-mini";
  const shouldCommit = (core.getInput("commit") || "true").toLowerCase() === "true";
  const token = core.getInput("github-token");

  if (detectLayout(localesDir, sourceLocale) === "none") {
    core.setFailed(
      `No source locale found. Expected ${localesDir}/${sourceLocale}.json or ${localesDir}/${sourceLocale}/*.json`
    );
    return;
  }

  const units = listTranslationUnits(localesDir, sourceLocale);
  if (units.length === 0) {
    core.info("No target locale files found. Nothing to translate.");
    core.setOutput("translated-keys", 0);
    return;
  }

  const sourceCache = new Map<string, Record<string, string>>();
  const perLocale = new Map<string, number>();
  let totalTranslated = 0;

  for (const unit of units) {
    let sourceFlat = sourceCache.get(unit.sourcePath);
    if (!sourceFlat) {
      sourceFlat = flatten(readJson(unit.sourcePath));
      sourceCache.set(unit.sourcePath, sourceFlat);
    }

    const targetObj: JsonObject = fs.existsSync(unit.targetPath) ? readJson(unit.targetPath) : {};
    const missing = missingKeys(sourceFlat, flatten(targetObj));
    if (Object.keys(missing).length === 0) continue;

    const label = unit.namespace ? `${unit.locale}/${unit.namespace}` : unit.locale;
    core.info(`${label}: translating ${Object.keys(missing).length} missing key(s)...`);

    const translated = await translateBatch(missing, {
      apiKey,
      model,
      targetLocale: unit.locale,
    });

    let applied = 0;
    for (const [key, value] of Object.entries(translated)) {
      setByPath(targetObj, key, value);
      applied++;
    }
    writeJson(unit.targetPath, targetObj);

    perLocale.set(unit.locale, (perLocale.get(unit.locale) ?? 0) + applied);
    totalTranslated += applied;
    core.info(`${label}: wrote ${applied} translation(s).`);
  }

  core.setOutput("translated-keys", totalTranslated);

  if (totalTranslated === 0) {
    core.info("All locales already up to date.");
    return;
  }

  if (shouldCommit) {
    await commitChanges(localesDir);
  }
  await postComment(token, perLocale, totalTranslated);
}

async function commitChanges(localesDir: string): Promise<void> {
  const headRef = github.context.payload.pull_request?.head?.ref;
  try {
    await exec.exec("git", ["config", "user.name", "i18n-autopilot[bot]"]);
    await exec.exec("git", [
      "config",
      "user.email",
      "i18n-autopilot[bot]@users.noreply.github.com",
    ]);
    await exec.exec("git", ["add", localesDir]);
    await exec.exec("git", ["commit", "-m", "chore(i18n): add missing translations [skip ci]"]);
    await exec.exec("git", headRef ? ["push", "origin", `HEAD:${headRef}`] : ["push"]);
    core.info("Committed and pushed translations.");
  } catch (err) {
    core.warning(
      `Could not commit translations automatically: ${(err as Error).message}. ` +
        "Ensure the workflow checks out the PR head ref and has contents:write permission."
    );
  }
}

async function postComment(
  token: string,
  perLocale: Map<string, number>,
  total: number
): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!token || !pr) return;
  try {
    const octokit = github.getOctokit(token);
    const lines = [...perLocale.entries()]
      .map(([locale, count]) => `- \`${locale}\`: ${count} key(s)`)
      .join("\n");
    const body = [
      "### 🌍 i18n Autopilot",
      "",
      `Translated **${total}** missing key(s):`,
      "",
      lines,
    ].join("\n");
    await octokit.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: pr.number,
      body,
    });
  } catch (err) {
    core.warning(`Could not post PR comment: ${(err as Error).message}`);
  }
}

run().catch((err) => core.setFailed((err as Error).message));
