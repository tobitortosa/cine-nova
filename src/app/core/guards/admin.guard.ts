import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateChildFn,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn & CanActivateChildFn = async (
  _ruta: ActivatedRouteSnapshot,
  estado: RouterStateSnapshot,
): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.cargando()) await auth.inicializar();

  if (auth.esAdmin()) return true;

  if (!auth.estaLogueado()) {
    return router.createUrlTree(['/auth/login'], { queryParams: { volverA: estado.url } });
  }

  return router.createUrlTree(['/']);
};
