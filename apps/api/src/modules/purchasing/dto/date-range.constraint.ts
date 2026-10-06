import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * When both date fields are present as parseable ISO strings, require from <= to.
 * Attached to the `from` property; reads sibling `to` via constraints.
 */
@ValidatorConstraint({ name: 'isDateRangeOrdered', async: false })
export class IsDateRangeOrderedConstraint implements ValidatorConstraintInterface {
  validate(fromValue: unknown, args: ValidationArguments): boolean {
    const [toKey] = args.constraints as [string];
    const obj = args.object as Record<string, unknown>;
    const toValue = obj[toKey];
    if (typeof fromValue !== 'string' || typeof toValue !== 'string' || !fromValue || !toValue) {
      return true;
    }
    const fromMs = Date.parse(fromValue);
    const toMs = Date.parse(toValue);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return true; // leave ISO validation to field validators
    }
    return fromMs <= toMs;
  }

  defaultMessage(args: ValidationArguments): string {
    const [toKey] = args.constraints as [string];
    return `${args.property} must be less than or equal to ${toKey}.`;
  }
}

/** Property decorator: this property (from) must be <= sibling `toKey` when both set. */
export function IsDateRangeStart(
  toKey: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'isDateRangeOrdered',
      target: object.constructor,
      propertyName: String(propertyName),
      constraints: [toKey],
      options: validationOptions,
      validator: IsDateRangeOrderedConstraint,
    });
  };
}
