package com.appalaya.even.classifier

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The on-device category model on Android (design.md "Model refinement"): not built yet. It always reports
 * unavailable and never answers, so the chip keeps the keyword guess and nothing waits on it.
 *
 * The planned model is Gemini Nano through the ML Kit GenAI Prompt API (com.google.mlkit:genai-prompt, 1.0.0-beta4
 * in September 2026). It is held back because it cannot be added cleanly today:
 * - it declares minSdk 26 and the app builds with React Native's default of 24, so the manifest merge fails until
 *   the app's floor is raised (expo-build-properties `android.minSdkVersion`), which is a product decision;
 * - it pulls in Google's datatransport and Firebase encoders (ML Kit's usage logging), which have to be checked
 *   against the privacy stance and the Play data-safety form first;
 * - constrained output (the equivalent of Apple's guided generation) is a separate alpha that needs KSP, so answers
 *   would be free text checked against the category list;
 * - it runs only on AICore phones with Gemini Nano (Pixel 9 and later, recent Galaxy flagships) and a locked
 *   bootloader, and nothing here can test it.
 * When it lands: Generation.getClient(), checkStatus() == FeatureStatus.AVAILABLE for `available` (DOWNLOADABLE and
 * DOWNLOADING as reasons), generateContent with temperature 0 inside withTimeoutOrNull(6000), and never download().
 */
class EvenClassifierModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EvenClassifier")

    AsyncFunction("availability") {
      mapOf("status" to "unavailable", "reason" to "notBuilt")
    }

    AsyncFunction("prewarm") {
      // Nothing to load.
    }

    AsyncFunction("classifyExpense") { title: String ->
      noAnswer(title)
    }
  }

  /** The iOS reply's shape (EvenClassifier.types.ts, `ClassifierReply`): no model, so no category. */
  private fun noAnswer(@Suppress("UNUSED_PARAMETER") title: String): Map<String, Any?> =
    mapOf("category" to null, "outcome" to "unavailable", "ms" to 0, "model" to null, "detail" to "notBuilt")
}
