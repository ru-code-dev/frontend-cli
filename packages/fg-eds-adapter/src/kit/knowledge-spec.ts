import type { KitSignature, KitSignaturesArtifact } from "../domain/artifacts.ts";

/**
 * Query facade over the embedded `kit-signatures` artifact. Ported from
 * `hackathon2026/ds-analyzer/src/kit/knowledge-spec.ts:1-47`, minus `load`/`unavailable`.
 *
 * `available` is retained and still guards the component-identity rules: a component verdict
 * without the signature index behind it would be a guess wearing a score.
 */
export class KnowledgeSpec {
  private readonly artifact: KitSignaturesArtifact;

  constructor(artifact: KitSignaturesArtifact) {
    this.artifact = artifact;
  }

  get available(): boolean {
    return this.artifact.signatures.length > 0;
  }

  get signatures(): readonly KitSignature[] {
    return this.artifact.signatures;
  }
}
