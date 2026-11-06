/** Acceptance is synchronous and optimistic. Completion reports durable storage. */
export type BoardSaveOutcome = { status: 'saved' } | { status: 'failed'; error: string };
export type BoardEdit = { status: 'unchanged' } | { status: 'accepted'; completion: Promise<BoardSaveOutcome> };
