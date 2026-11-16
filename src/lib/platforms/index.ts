import type { PlatformAdapter } from "../types";
import { bolt } from "./bolt";
import { glovo } from "./glovo";
import { wolt } from "./wolt";

export const adapters: PlatformAdapter[] = [wolt, glovo, bolt];
