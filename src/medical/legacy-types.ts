// Structural types for the unchanged Azm 2.0 condition configuration.
export type DisabilityType='mobility'|'neurological'|'musculoskeletal'|'chronic'|'amputation'|'other';
export type DetailedDisabilitySubType=string;
export type ExerciseCategory=string;
export interface DisabilityConfig {
 disabilityType:DisabilityType;subType?:string;maxSessionMinutes:number;restMultiplier:number;
 fatigueRisk:'critical'|'high'|'medium'|'low';warmUpMinutes:number;coolDownMinutes:number;
 preferredIntensity:string;specialConsiderations:string[];recommendedCategories:string[];avoidCategories:string[];
 requiresMedicalClearance?:boolean;minimumRecoveryHours?:number;maxExerciseBoutMinutes?:number;
 thermoregulationWarning?:boolean;postExertionalMalaiseRisk?:boolean;
}
