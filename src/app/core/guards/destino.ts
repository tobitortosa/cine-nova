import { AuthService } from '../services/auth.service';

export function volverAValido(volverA: string | null | undefined): string | null {
  if (!volverA || !volverA.startsWith('/')) return null;
  if (volverA.startsWith('//') || volverA.startsWith('/\\')) return null;
  if (/^\/auth(\/|\?|#|$)/.test(volverA)) return null;
  return volverA;
}

export function destinoDespuesDeIngresar(
  auth: Pick<AuthService, 'esAdmin' | 'esEmpleado'>,
  volverA: string | null | undefined,
): string {
  const pedido = volverAValido(volverA);
  if (pedido) return pedido;
  if (auth.esAdmin()) return '/admin';
  if (auth.esEmpleado()) return '/empleado';
  return '/';
}
