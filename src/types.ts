export type Address = `0x${string}`

export type HazardStatus = 'OPEN' | 'PENDING_COUNTERSIGNATURE' | 'COVERED'
export type MitigationVerdict = 'MITIGATION_SUFFICIENT' | 'SAFETY_GAP' | ''

export interface GateConfig {
  name: string
  version: string
  semantic_verdicts: string[]
  hazard_statuses: string[]
  min_hazards: number
  max_hazards: number
  max_hazard_length: number
  max_mitigation_length: number
  max_challenge_length: number
  max_attempts_per_hazard: number
  max_lifetime_attempts_per_hazard: number
  reviewer_required: boolean
  challenge_enabled: boolean
  evidence_binding: string
  same_evidence_reroll_blocked: boolean
  prompt_inputs: string[]
  system_purpose_enters_prompt: boolean
  coverage_gate: string
  global_admin: boolean
  clock_used: boolean
  system_count: number
  mitigation_count: number
  challenge_count: number
}

export interface SystemRecord {
  system_id: number
  owner: string
  reviewer: string
  system_purpose: string
  required_hazard_count: number
  covered_count: number
  open_count: number
  pending_count: number
  gap_attempts: number
  mitigation_count: number
  challenge_count: number
  all_hazards_covered: boolean
  release_ready: boolean
  released_by: string
}

export interface HazardRecord {
  system_id: number
  hazard_index: number
  text: string
  status: HazardStatus
  covered_by: number
  pending_mitigation_id: number
  attempt_count: number
  lifetime_attempt_count: number
}

export interface MitigationRecord {
  mitigation_id: number
  system_id: number
  hazard_index: number
  text: string
  evidence_digest: string
  verdict: MitigationVerdict
}

export interface SystemMitigation {
  system_attempt_index: number
  mitigation_id: number
  hazard_index: number
  text: string
  evidence_digest: string
  verdict: MitigationVerdict
}

export interface HazardAttempt {
  hazard_attempt_index: number
  mitigation_id: number
  text: string
  evidence_digest: string
  verdict: MitigationVerdict
}

export interface ChallengeRecord {
  system_challenge_index?: number
  challenge_id: number
  system_id?: number
  hazard_index: number
  mitigation_id: number
  previous_status: string
  reason: string
  challenged_by: string
}
