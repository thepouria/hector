import {
  ChannelSettlementComponentEffect,
  ChannelSettlementComponentType,
  Prisma,
} from '@hector/database';

export type ChannelSettlementComponentInput = {
  type: ChannelSettlementComponentType;
  effect: ChannelSettlementComponentEffect;
  amount: Prisma.Decimal;
};

/**
 * Canonical Expected Net calculation (Phase 6.3).
 * Deterministic: INCREASE adds, DECREASE subtracts. Always Decimal.
 */
export function calculateExpectedNet(
  components: ChannelSettlementComponentInput[],
): Prisma.Decimal {
  let net = new Prisma.Decimal(0);
  for (const c of components) {
    if (c.effect === ChannelSettlementComponentEffect.INCREASE) {
      net = net.plus(c.amount);
    } else {
      net = net.minus(c.amount);
    }
  }
  return net;
}

/** Allowed effect per component type. */
export function isValidComponentEffect(
  type: ChannelSettlementComponentType,
  effect: ChannelSettlementComponentEffect,
): boolean {
  switch (type) {
    case ChannelSettlementComponentType.GROSS_SALES:
      return effect === ChannelSettlementComponentEffect.INCREASE;
    case ChannelSettlementComponentType.COMMISSION:
    case ChannelSettlementComponentType.RETURN:
    case ChannelSettlementComponentType.FEE:
      return effect === ChannelSettlementComponentEffect.DECREASE;
    case ChannelSettlementComponentType.ADJUSTMENT:
      return true;
    default:
      return false;
  }
}

export function componentRequiresDescription(
  type: ChannelSettlementComponentType,
): boolean {
  return (
    type === ChannelSettlementComponentType.FEE ||
    type === ChannelSettlementComponentType.ADJUSTMENT
  );
}
