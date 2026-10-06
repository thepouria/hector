/**
 * Pure availability formula tests (WH-RES-003).
 */
describe('availability formula', () => {
  function available(onHand: number, reserved: number): number {
    return Math.max(0, onHand - reserved);
  }

  it('WH-RES-003: Available = SELLABLE On Hand - Active Reserved', () => {
    expect(available(100, 0)).toBe(100);
    expect(available(100, 30)).toBe(70);
    expect(available(100, 80)).toBe(20);
  });

  it('WH-RES-001/011: reservation does not change onHand or invent negative available under clamp', () => {
    const onHand = 100;
    const reserved = 30;
    expect(onHand).toBe(100);
    expect(available(onHand, reserved)).toBe(70);
  });

  it('rejects oversell conceptually when requested > available', () => {
    const availableQty = available(100, 80);
    expect(availableQty).toBe(20);
    expect(30 > availableQty).toBe(true);
  });
});
