/** Pointer identity and one terminal transition shared by native pointer adapters. */
export class PointerSession<T> {
  current?: { pointerId: number; data: T };
  begin(pointerId: number, data: T) { if (this.current) return false; this.current = { pointerId, data }; return true; }
  read(pointerId: number) { return this.current?.pointerId === pointerId ? this.current.data : undefined; }
  finish(pointerId: number) { const data = this.read(pointerId); if (data !== undefined) this.current = undefined; return data; }
  cancel() { const data = this.current?.data; this.current = undefined; return data; }
}
