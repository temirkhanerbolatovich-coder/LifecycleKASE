export const LEGACY_TOKEN_POLICY = "LEGACY_UNRESTRICTED_V1";
export const CONTROLLED_TOKEN_POLICY = "CONTROLLED_FROZEN_V2";
const LOCALNET_CANDIDATE_PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";

export class ControlledRegistryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message); this.name = "ControlledRegistryError";
  }
}

export function controlledRegistryEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment.CONTROLLED_REGISTRY_ENABLED;
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new ControlledRegistryError("INSTRUMENT_CONFIGURATION_INVALID", "CONTROLLED_REGISTRY_ENABLED must be true or false", 503);
  }
  return value === "true";
}

/** New controlled instruments require the explicitly enabled disposable Localnet candidate. */
export function requireControlledRegistry(instrument: { tokenPolicy?: string | null }, options: {
  cluster: "localnet" | "devnet"; programId: string; controlledRegistryEnabled?: boolean | undefined;
}): boolean {
  if (instrument.tokenPolicy === undefined || instrument.tokenPolicy === LEGACY_TOKEN_POLICY) return false;
  if (instrument.tokenPolicy !== CONTROLLED_TOKEN_POLICY) {
    throw new ControlledRegistryError("INSTRUMENT_TOKEN_POLICY_INVALID", "Instrument token policy is unsupported");
  }
  if (options.controlledRegistryEnabled !== true || options.cluster !== "localnet" || options.programId !== LOCALNET_CANDIDATE_PROGRAM) {
    throw new ControlledRegistryError("CONTROLLED_REGISTRY_DISABLED", "Controlled registry requires the enabled Localnet candidate", 503);
  }
  return true;
}
