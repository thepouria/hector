import { AttributeScope, AttributeType } from '@hector/database';
import {
  assertAttributeScopeAllows,
  normalizeAttributeValueInput,
  type AttributeOptionRef,
} from './attribute-value.util';

describe('attribute-value.util', () => {
  const options = new Map<string, AttributeOptionRef>([
    [
      'opt-matte',
      { id: 'opt-matte', attributeDefinitionId: 'attr-finish', isActive: true, value: 'مات' },
    ],
    [
      'opt-glossy',
      { id: 'opt-glossy', attributeDefinitionId: 'attr-finish', isActive: true, value: 'براق' },
    ],
    [
      'opt-inactive',
      { id: 'opt-inactive', attributeDefinitionId: 'attr-finish', isActive: false, value: 'قدیمی' },
    ],
    [
      'opt-skin',
      { id: 'opt-skin', attributeDefinitionId: 'attr-skin', isActive: true, value: 'چرب' },
    ],
  ]);

  it('treats empty Product/SKU attribute inputs as clear (optionality)', () => {
    expect(
      normalizeAttributeValueInput(AttributeType.TEXT, 'a1', { attributeId: 'a1' }, options),
    ).toEqual({ kind: 'clear', attributeId: 'a1' });
    expect(
      normalizeAttributeValueInput(
        AttributeType.TEXT,
        'a1',
        { attributeId: 'a1', textValue: '   ' },
        options,
      ),
    ).toEqual({ kind: 'clear', attributeId: 'a1' });
    expect(
      normalizeAttributeValueInput(AttributeType.NUMBER, 'a1', { attributeId: 'a1' }, options),
    ).toEqual({ kind: 'clear', attributeId: 'a1' });
    expect(
      normalizeAttributeValueInput(AttributeType.BOOLEAN, 'a1', { attributeId: 'a1' }, options),
    ).toEqual({ kind: 'clear', attributeId: 'a1' });
    expect(
      normalizeAttributeValueInput(
        AttributeType.MULTI_SELECT,
        'attr-finish',
        { attributeId: 'attr-finish', optionIds: [] },
        options,
      ),
    ).toEqual({ kind: 'clear', attributeId: 'attr-finish' });
  });

  it('does not coerce undefined boolean to false', () => {
    const cleared = normalizeAttributeValueInput(
      AttributeType.BOOLEAN,
      'a1',
      { attributeId: 'a1', booleanValue: undefined },
      options,
    );
    expect(cleared).toEqual({ kind: 'clear', attributeId: 'a1' });

    const falseValue = normalizeAttributeValueInput(
      AttributeType.BOOLEAN,
      'a1',
      { attributeId: 'a1', booleanValue: false },
      options,
    );
    expect(falseValue).toEqual({ kind: 'boolean', attributeId: 'a1', booleanValue: false });
  });

  it('validates NUMBER and rejects non-numeric', () => {
    const ok = normalizeAttributeValueInput(
      AttributeType.NUMBER,
      'a1',
      { attributeId: 'a1', numberValue: 50 },
      options,
    );
    expect(ok.kind).toBe('number');
    if (ok.kind === 'number') {
      expect(ok.numberValue.toNumber()).toBe(50);
    }

    expect(() =>
      normalizeAttributeValueInput(
        AttributeType.NUMBER,
        'a1',
        { attributeId: 'a1', numberValue: Number.NaN },
        options,
      ),
    ).toThrow();
  });

  it('validates SINGLE_SELECT and MULTI_SELECT option ownership', () => {
    const single = normalizeAttributeValueInput(
      AttributeType.SINGLE_SELECT,
      'attr-finish',
      { attributeId: 'attr-finish', optionIds: ['opt-matte'] },
      options,
    );
    expect(single).toEqual({
      kind: 'select',
      attributeId: 'attr-finish',
      optionIds: ['opt-matte'],
    });

    expect(() =>
      normalizeAttributeValueInput(
        AttributeType.SINGLE_SELECT,
        'attr-finish',
        { attributeId: 'attr-finish', optionIds: ['opt-matte', 'opt-glossy'] },
        options,
      ),
    ).toThrow();

    expect(() =>
      normalizeAttributeValueInput(
        AttributeType.MULTI_SELECT,
        'attr-finish',
        { attributeId: 'attr-finish', optionIds: ['opt-matte', 'opt-matte'] },
        options,
      ),
    ).toThrow();

    expect(() =>
      normalizeAttributeValueInput(
        AttributeType.MULTI_SELECT,
        'attr-finish',
        { attributeId: 'attr-finish', optionIds: ['opt-skin'] },
        options,
      ),
    ).toThrow();

    expect(() =>
      normalizeAttributeValueInput(
        AttributeType.SINGLE_SELECT,
        'attr-finish',
        { attributeId: 'attr-finish', optionIds: ['opt-inactive'] },
        options,
      ),
    ).toThrow();
  });

  it('enforces AttributeScope without making values required', () => {
    expect(() => assertAttributeScopeAllows(AttributeScope.PRODUCT, 'SKU')).toThrow();
    expect(() => assertAttributeScopeAllows(AttributeScope.SKU, 'PRODUCT')).toThrow();
    expect(() => assertAttributeScopeAllows(AttributeScope.PRODUCT, 'PRODUCT')).not.toThrow();
    expect(() => assertAttributeScopeAllows(AttributeScope.BOTH, 'SKU')).not.toThrow();
  });
});
