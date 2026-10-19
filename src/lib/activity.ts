export type Receipt = { source: string; destination: string; success: boolean; error?: string }
export type SavedRun = { id: string; at: string; demo: boolean; results: Receipt[] }
