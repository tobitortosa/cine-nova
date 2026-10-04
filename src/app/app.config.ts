import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
} from '@angular/router';
import { SwUpdate, provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { CarritoService } from './core/services/carrito.service';
import { NotificacionesService } from './core/services/notificaciones.service';

const CLAVE_RECARGA = 'cinenova_recarga';
const ERROR_DE_CARGA = /dynamically imported module|Importing a module script failed|Loading chunk/i;

function recargarSiFallaLaCarga(evento: NavigationError): void {
  const error = evento.error as { message?: unknown } | null | undefined;
  const mensaje = String(error?.message ?? evento.error ?? '');
  if (!ERROR_DE_CARGA.test(mensaje)) return;

  try {
    if (sessionStorage.getItem(CLAVE_RECARGA) === evento.url) return;
    sessionStorage.setItem(CLAVE_RECARGA, evento.url);
  } catch {
    return;
  }

  window.location.assign(evento.url);
}

function olvidarRecarga(): void {
  try {
    sessionStorage.removeItem(CLAVE_RECARGA);
  } catch {
    return;
  }
}

function vigilarActualizaciones(): void {
  const actualizador = inject(SwUpdate);
  const router = inject(Router);
  const carrito = inject(CarritoService);
  const avisos = inject(NotificacionesService);

  router.events.subscribe((evento) => {
    if (evento instanceof NavigationEnd) olvidarRecarga();
  });

  if (!actualizador.isEnabled) return;

  let versionNueva = false;

  actualizador.versionUpdates.subscribe((evento) => {
    if (evento.type !== 'VERSION_READY' || versionNueva) return;
    versionNueva = true;
    avisos.info('Hay una versión nueva de CineNova. Se va a cargar cuando cambies de página.');
  });

  actualizador.unrecoverable.subscribe(() => window.location.reload());

  const enCompra = (url: string) =>
    url.startsWith('/comprar') || url.startsWith('/candy') || url.startsWith('/auth');
  const ruta = (url: string) => url.split(/[?#]/)[0];

  router.events.subscribe((evento) => {
    if (!(evento instanceof NavigationStart) || !versionNueva) return;
    if (router.currentNavigation()?.extras.state) return;
    if (ruta(evento.url) === ruta(router.url)) return;
    const eligiendo = carrito.butacas().length > 0 && (enCompra(router.url) || enCompra(evento.url));
    if (eligiendo) return;
    window.location.assign(evento.url);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || versionNueva) return;
    actualizador.checkForUpdate().catch(() => false);
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withNavigationErrorHandler(recargarSiFallaLaCarga),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(vigilarActualizaciones),
  ],
};
