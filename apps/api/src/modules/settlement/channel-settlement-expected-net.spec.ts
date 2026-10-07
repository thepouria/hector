import {
  calculateExpectedNet,
  componentRequiresDescription,
  isValidComponentEffect,
} from './channel-settlement-expected-net';
import {
  ChannelSettlementComponentEffect,
  ChannelSettlementComponentType,
  Prisma,
} from '@hector/database';

describe('channel-settlement-expected-net', () => {
  it('calculates gross only', () => {
    expect(
      calculateExpectedNet([
        {
          type: ChannelSettlementComponentType.GROSS_SALES,
          effect: ChannelSettlementComponentEffect.INCREASE,
          amount: new Prisma.Decimal('2000000000'),
        },
      ]).toString(),
    ).toBe('2000000000');
  });

  it('calculates Khanoumi target scenario', () => {
    const net = calculateExpectedNet([
      {
        type: ChannelSettlementComponentType.GROSS_SALES,
        effect: ChannelSettlementComponentEffect.INCREASE,
        amount: new Prisma.Decimal('2000000000'),
      },
      {
        type: ChannelSettlementComponentType.COMMISSION,
        effect: ChannelSettlementComponentEffect.DECREASE,
        amount: new Prisma.Decimal('500000000'),
      },
      {
        type: ChannelSettlementComponentType.RETURN,
        effect: ChannelSettlementComponentEffect.DECREASE,
        amount: new Prisma.Decimal('20000000'),
      },
      {
        type: ChannelSettlementComponentType.FEE,
        effect: ChannelSettlementComponentEffect.DECREASE,
        amount: new Prisma.Decimal('10000000'),
      },
      {
        type: ChannelSettlementComponentType.ADJUSTMENT,
        effect: ChannelSettlementComponentEffect.INCREASE,
        amount: new Prisma.Decimal('5000000'),
      },
    ]);
    expect(net.toString()).toBe('1475000000');
  });

  it('supports multiple fees and negative adjustment', () => {
    const net = calculateExpectedNet([
      {
        type: ChannelSettlementComponentType.GROSS_SALES,
        effect: ChannelSettlementComponentEffect.INCREASE,
        amount: new Prisma.Decimal('1000'),
      },
      {
        type: ChannelSettlementComponentType.FEE,
        effect: ChannelSettlementComponentEffect.DECREASE,
        amount: new Prisma.Decimal('50'),
      },
      {
        type: ChannelSettlementComponentType.FEE,
        effect: ChannelSettlementComponentEffect.DECREASE,
        amount: new Prisma.Decimal('30'),
      },
      {
        type: ChannelSettlementComponentType.ADJUSTMENT,
        effect: ChannelSettlementComponentEffect.DECREASE,
        amount: new Prisma.Decimal('20'),
      },
    ]);
    expect(net.toString()).toBe('900');
  });

  it('validates component effects', () => {
    expect(
      isValidComponentEffect(
        ChannelSettlementComponentType.GROSS_SALES,
        ChannelSettlementComponentEffect.DECREASE,
      ),
    ).toBe(false);
    expect(
      isValidComponentEffect(
        ChannelSettlementComponentType.COMMISSION,
        ChannelSettlementComponentEffect.INCREASE,
      ),
    ).toBe(false);
    expect(
      isValidComponentEffect(
        ChannelSettlementComponentType.ADJUSTMENT,
        ChannelSettlementComponentEffect.INCREASE,
      ),
    ).toBe(true);
    expect(componentRequiresDescription(ChannelSettlementComponentType.FEE)).toBe(true);
  });
});
