import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { destinoDespuesDeIngresar } from './destino';

export const invitadoGuard: CanActivateFn = async (ruta: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.cargando()) await auth.inicializar();

  if (auth.estaLogueado()) {
    return router.parseUrl(destinoDespuesDeIngresar(auth, ruta.queryParamMap.get('volverA')));
  }

  return true;
};
