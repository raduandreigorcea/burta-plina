import type { PlatformAdapter } from "../types";
import { glovo } from "./glovo";
import { wolt } from "./wolt";

export const adapters: PlatformAdapter[] = [wolt, glovo];
