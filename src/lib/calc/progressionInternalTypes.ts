export type ProgressionClassification =
    | 'performance_record'
    | 'progression'
    | 'output_up_effort_up'
    | 'output_lower'
    | 'stable'
    | 'stable_less_effort'
    | 'stable_more_effort'
    | 'volume_progression'
    | 'maintenance_stable'
    | 'maintenance_change'
    | 'deload_change'
    | 'new_baseline'
    | 'execution_baseline'
    | 'density_limited'
    | 'descriptive_change'
    | 'insufficient_data';

export type OutputChange = 'better' | 'same' | 'worse' | 'longer' | 'shorter' | 'mixed' | 'unknown';
