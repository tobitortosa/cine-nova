import { AbstractControl, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { hoyLocal } from './ventas';

export const TIPOS_SANGRE: readonly string[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const COLORES_OJOS: readonly string[] = [
  'Marrones',
  'Negros',
  'Miel',
  'Verdes',
  'Celestes',
  'Azules',
  'Grises',
];

const DIAS_VACACIONES_MAXIMOS = 365;

export const fechaNoFutura: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const valor = typeof control.value === 'string' ? control.value.slice(0, 10) : '';
  if (!valor) return null;
  return valor > hoyLocal() ? { futura: true } : null;
};

const diasEnteros: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const valor = control.value;
  if (valor === null || valor === undefined || valor === '') return null;
  return Number.isInteger(Number(valor)) ? null : { entero: true };
};

export const validadoresDiasVacaciones: ValidatorFn[] = [
  Validators.required,
  Validators.min(0),
  Validators.max(DIAS_VACACIONES_MAXIMOS),
  diasEnteros,
];
