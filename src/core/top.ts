/**
 * Keeps the `limit` largest items seen, in O(limit) memory and O(log limit)
 * time per insertion, using a binary min-heap keyed by `score`.
 *
 * Ties are broken by `tieBreak`, so the selection is deterministic even when
 * items arrive in a different order between runs.
 */
export class TopK<T> {
    readonly limit: number;
    readonly #heap: Array<{ score: number; item: T }> = [];
    readonly #tieBreak: (a: T, b: T) => number;

    /** @param tieBreak Negative when `a` should rank above `b` among equal scores. */
    constructor(limit: number, tieBreak: (a: T, b: T) => number = () => 0) {
        this.limit = Math.max(0, Math.floor(limit));
        this.#tieBreak = tieBreak;
    }

    get size(): number {
        return this.#heap.length;
    }

    /** Cheap pre-check, so callers can skip building items that would be rejected. */
    accepts(score: number): boolean {
        if (this.limit === 0) return false;
        if (this.#heap.length < this.limit) return true;
        return score >= this.#heap[0]!.score;
    }

    push(score: number, item: T): void {
        if (!this.accepts(score)) return;
        const entry = { score, item };
        if (this.#heap.length < this.limit) {
            this.#heap.push(entry);
            this.#siftUp(this.#heap.length - 1);
        } else if (this.#ranksAbove(entry, this.#heap[0]!)) {
            this.#heap[0] = entry;
            this.#siftDown(0);
        }
    }

    /** Items from highest to lowest score. */
    sorted(): T[] {
        return [...this.#heap]
            .sort((a, b) => (this.#ranksAbove(a, b) ? -1 : this.#ranksAbove(b, a) ? 1 : 0))
            .map((e) => e.item);
    }

    #ranksAbove(a: { score: number; item: T }, b: { score: number; item: T }): boolean {
        if (a.score !== b.score) return a.score > b.score;
        return this.#tieBreak(a.item, b.item) < 0;
    }

    #siftUp(index: number): void {
        const heap = this.#heap;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.#ranksAbove(heap[parent]!, heap[index]!)) break;
            [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
            index = parent;
        }
    }

    #siftDown(index: number): void {
        const heap = this.#heap;
        for (;;) {
            const left = index * 2 + 1;
            const right = left + 1;
            let lowest = index;
            if (left < heap.length && this.#ranksAbove(heap[lowest]!, heap[left]!)) lowest = left;
            if (right < heap.length && this.#ranksAbove(heap[lowest]!, heap[right]!)) {
                lowest = right;
            }
            if (lowest === index) return;
            [heap[lowest], heap[index]] = [heap[index]!, heap[lowest]!];
            index = lowest;
        }
    }
}
