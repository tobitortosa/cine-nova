import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const empleadoGuard: CanActivateFn = async (
  _ruta: ActivatedRouteSnapshot,
  estado: RouterStateSnapshot,
): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.cargando()) await auth.inicializar();

  if (auth.esEmpleado()) return true;

  if (!auth.estaLogueado()) {
    return router.createUrlTree(['/auth/login'], { queryParams: { volverA: estado.url } });
  }

  return router.createUrlTree(['/']);
};
