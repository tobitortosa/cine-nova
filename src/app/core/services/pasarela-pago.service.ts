import { Injectable } from '@angular/core';
import { MedioPago } from '../models/modelos';
import { detectarMarca, luhnValido, soloDigitos } from '../../shared/validators/tarjeta.validators';

export type MedioCobrable = Exclude<MedioPago, 'sin_cargo'>;

export interface SolicitudPago {
  medio: MedioCobrable;
  monto: number;
  numero?: string;
}

export interface ResultadoPago {
  aprobado: boolean;
  motivo?: string;
  autorizacion?: string;
  marca: string | null;
  ultimos4: string | null;
}

export interface TarjetaDePrueba {
  numero: string;
  marca: string;
  resultado: string;
  aprobada: boolean;
}

const RECHAZOS: Record<string, string> = {
  '4000000000000002': 'El banco emisor rechazó la tarjeta. Probá con otro medio de pago.',
  '4000000000009995': 'La tarjeta no tiene fondos suficientes para esta compra.',
};

@Injectable({ providedIn: 'root' })
export class PasarelaPagoService {
  readonly tarjetasDePrueba: TarjetaDePrueba[] = [
    { numero: '4242 4242 4242 4242', marca: 'Visa', resultado: 'Aprobada', aprobada: true },
    { numero: '5555 5555 5555 4444', marca: 'Mastercard', resultado: 'Aprobada', aprobada: true },
    { numero: '3782 822463 10005', marca: 'American Express', resultado: 'Aprobada', aprobada: true },
    { numero: '4000 0000 0000 0002', marca: 'Visa', resultado: 'Rechazada', aprobada: false },
    { numero: '4000 0000 0000 9995', marca: 'Visa', resultado: 'Sin fondos', aprobada: false },
  ];

  async procesar(solicitud: SolicitudPago): Promise<ResultadoPago> {
    await this.esperar(1500);

    if (!(solicitud.monto > 0)) {
      return { aprobado: false, motivo: 'El monto a cobrar no es válido', marca: null, ultimos4: null };
    }

    if (solicitud.medio === 'mercado_pago') {
      return { aprobado: true, autorizacion: this.autorizacion(), marca: null, ultimos4: null };
    }

    const numero = soloDigitos(solicitud.numero);
    const marca = detectarMarca(numero);

    if (!marca || !luhnValido(numero)) {
      return { aprobado: false, motivo: 'Los datos de la tarjeta no son válidos', marca: null, ultimos4: null };
    }

    const rechazo = RECHAZOS[numero];
    if (rechazo) {
      return { aprobado: false, motivo: rechazo, marca, ultimos4: numero.slice(-4) };
    }

    return { aprobado: true, autorizacion: this.autorizacion(), marca, ultimos4: numero.slice(-4) };
  }

  private autorizacion(): string {
    return Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, ms));
  }
}
