import { Pipe, PipeTransform } from '@angular/core';
import { Compra, MedioPago } from '../../core/models/modelos';

export type FormatoMedioPago = 'largo' | 'corto';

export type DatosMedioPago = Pick<Compra, 'medio_pago' | 'tarjeta_marca' | 'tarjeta_ultimos4'>;

const NOMBRES: Record<MedioPago, string> = {
  tarjeta_credito: 'Tarjeta de crédito',
  tarjeta_debito: 'Tarjeta de débito',
  mercado_pago: 'Mercado Pago',
  sin_cargo: 'Sin cargo',
};

export function textoMedioPago(
  compra: DatosMedioPago | null | undefined,
  formato: FormatoMedioPago = 'largo',
): string {
  if (!compra?.medio_pago) return 'No registrado';

  const medio = compra.medio_pago;
  if (medio !== 'tarjeta_credito' && medio !== 'tarjeta_debito') return NOMBRES[medio];

  const marca = compra.tarjeta_marca?.trim() || null;
  const ultimos4 = compra.tarjeta_ultimos4?.trim() || null;

  if (formato === 'corto') {
    const nombre = marca ?? (medio === 'tarjeta_credito' ? 'Crédito' : 'Débito');
    return ultimos4 ? `${nombre} •••• ${ultimos4}` : nombre;
  }

  return [NOMBRES[medio], marca, ultimos4 ? `terminada en ${ultimos4}` : null]
    .filter(Boolean)
    .join(' ');
}

@Pipe({ name: 'medioPago' })
export class MedioPagoPipe implements PipeTransform {
  transform(compra: DatosMedioPago | null | undefined, formato: FormatoMedioPago = 'largo'): string {
    return textoMedioPago(compra, formato);
  }
}
