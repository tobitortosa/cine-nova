import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export type MarcaTarjeta = 'Visa' | 'Mastercard' | 'American Express';

const LARGOS: Record<MarcaTarjeta, number[]> = {
  Visa: [13, 16, 19],
  Mastercard: [16],
  'American Express': [15],
};

export function soloDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

export function detectarMarca(numero: string | null | undefined): MarcaTarjeta | null {
  const digitos = soloDigitos(numero);
  if (/^4/.test(digitos)) return 'Visa';
  if (/^(5[1-5]|2(22[1-9]|2[3-9]|[3-6]|7[01]|720))/.test(digitos)) return 'Mastercard';
  if (/^3[47]/.test(digitos)) return 'American Express';
  return null;
}

export function luhnValido(numero: string | null | undefined): boolean {
  const digitos = soloDigitos(numero);
  if (digitos.length < 12) return false;

  let suma = 0;
  let duplicar = false;

  for (let i = digitos.length - 1; i >= 0; i--) {
    let cifra = Number(digitos[i]);
    if (duplicar) {
      cifra *= 2;
      if (cifra > 9) cifra -= 9;
    }
    suma += cifra;
    duplicar = !duplicar;
  }

  return suma % 10 === 0;
}

export function largoCvv(numero: string | null | undefined): number {
  return detectarMarca(numero) === 'American Express' ? 4 : 3;
}

export function formatearNumeroTarjeta(valor: string | null | undefined): string {
  const digitos = soloDigitos(valor);

  if (detectarMarca(digitos) === 'American Express') {
    const amex = digitos.slice(0, 15);
    return [amex.slice(0, 4), amex.slice(4, 10), amex.slice(10)].filter(Boolean).join(' ');
  }

  return digitos.slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatearVencimiento(valor: string | null | undefined): string {
  const digitos = soloDigitos(valor).slice(0, 4);
  return digitos.length > 2 ? `${digitos.slice(0, 2)}/${digitos.slice(2)}` : digitos;
}

export const numeroTarjetaValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const digitos = soloDigitos(control.value);
  if (!digitos) return null;

  const marca = detectarMarca(digitos);
  if (!marca) return { marcaNoSoportada: true };
  if (!LARGOS[marca].includes(digitos.length)) return { largoInvalido: { marca } };
  if (!luhnValido(digitos)) return { numeroInvalido: true };

  return null;
};

export const vencimientoValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const valor = String(control.value ?? '').trim();
  if (!valor) return null;

  const partes = /^(\d{2})\/(\d{2})$/.exec(valor);
  if (!partes) return { formatoVencimiento: true };

  const mes = Number(partes[1]);
  const anio = 2000 + Number(partes[2]);
  if (mes < 1 || mes > 12) return { formatoVencimiento: true };

  const hoy = new Date();
  const ultimoDiaDelMes = new Date(anio, mes, 0, 23, 59, 59);
  if (ultimoDiaDelMes < hoy) return { tarjetaVencida: true };
  if (anio > hoy.getFullYear() + 20) return { vencimientoLejano: true };

  return null;
};

export const titularValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const valor = String(control.value ?? '').trim().replace(/\s+/g, ' ');
  if (!valor) return null;

  const soloLetras = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]+$/.test(valor);
  const nombreYApellido = valor.split(' ').filter((parte) => parte.length >= 2).length >= 2;

  return soloLetras && nombreYApellido ? null : { titularInvalido: true };
};

export function cvvSegunMarcaValidator(campoNumero = 'numero', campoCvv = 'cvv'): ValidatorFn {
  return (grupo: AbstractControl): ValidationErrors | null => {
    const numero = grupo.get(campoNumero);
    const cvv = grupo.get(campoCvv);
    if (!numero || !cvv) return null;

    const valor = soloDigitos(cvv.value);
    if (!valor) return null;

    const esperado = largoCvv(numero.value);
    return valor.length === esperado ? null : { cvvInvalido: { esperado } };
  };
}
