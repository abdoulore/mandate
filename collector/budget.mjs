/** One explicit cap for every collector HTTP attempt, including retries. */
export class CollectorBudget {
  #limit;
  #used = 0;

  constructor(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error('COLLECTOR_BUDGET_INVALID');
    this.#limit = limit;
  }

  consume() {
    if (this.#used >= this.#limit) throw new Error('COLLECTOR_BUDGET_EXHAUSTED');
    this.#used++;
  }

  get used() { return this.#used; }
  get limit() { return this.#limit; }
  get remaining() { return this.#limit - this.#used; }
}

export function requireBudget(budget) {
  if (!(budget instanceof CollectorBudget)) throw new Error('COLLECTOR_BUDGET_REQUIRED');
  return budget;
}
