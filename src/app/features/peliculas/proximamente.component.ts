import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PeliculasService } from '../../core/services/peliculas.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Pelicula } from '../../core/models/modelos';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { diasHasta, preventaVigente } from '../../shared/utils/ventas';

@Component({
  selector: 'app-proximamente',
  imports: [
    RouterLink,
    DuracionPipe,
    RestriccionPipe,
    PrecioPipe,
    CargandoComponent,
    VacioComponent,
  ],
  templateUrl: './proximamente.component.html',
  styleUrl: './proximamente.component.scss',
})
export class ProximamenteComponent implements OnInit {
  private readonly peliculas = inject(PeliculasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);

  readonly auth = inject(AuthService);

  readonly lista = signal<Pelicula[]>([]);
  readonly alertas = signal<number[]>([]);
  readonly cargando = signal(true);
  readonly procesando = signal<number | null>(null);

  readonly estrenos = computed(() =>
    [...this.lista()].sort((a, b) => this.marca(a) - this.marca(b)),
  );

  readonly conPreventa = computed(
    () => this.estrenos().filter((pelicula) => this.preventaAbierta(pelicula)).length,
  );

  async ngOnInit(): Promise<void> {
    try {
      this.lista.set(await this.peliculas.proximosEstrenos());
      this.alertas.set(await this.peliculas.misAlertas());
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar los estrenos');
    } finally {
      this.cargando.set(false);
    }
  }

  tieneAlerta(id: number): boolean {
    return this.alertas().includes(id);
  }

  dias(pelicula: Pelicula): number {
    return diasHasta(pelicula.fecha_estreno) ?? 0;
  }

  cuenta(pelicula: Pelicula): string {
    const restantes = this.dias(pelicula);
    if (restantes < 0) return 'Estreno inminente';
    if (restantes === 0) return 'Se estrena hoy';
    if (restantes === 1) return 'Falta 1 día';
    return `Faltan ${restantes} días`;
  }

  fecha(pelicula: Pelicula): string {
    const estreno = this.aFecha(pelicula.fecha_estreno);
    if (!estreno) return 'Fecha a confirmar';

    const texto = new Intl.DateTimeFormat('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(estreno);

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  preventaAbierta(pelicula: Pelicula): boolean {
    return preventaVigente(pelicula);
  }

  async alternarAlerta(pelicula: Pelicula): Promise<void> {
    if (!this.auth.estaLogueado()) {
      this.avisos.info('Ingresá a tu cuenta para activar la alerta');
      await this.router.navigate(['/auth/login'], { queryParams: { volverA: '/proximamente' } });
      return;
    }

    this.procesando.set(pelicula.id);

    try {
      const activada = await this.peliculas.alternarAlerta(pelicula.id);

      this.alertas.update((actuales) =>
        activada
          ? [...actuales, pelicula.id]
          : actuales.filter((id) => id !== pelicula.id),
      );

      this.avisos.exito(
        activada
          ? `Te avisamos cuando se estrene ${pelicula.titulo}`
          : `Sacamos la alerta de ${pelicula.titulo}`,
      );
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo cambiar la alerta');
    } finally {
      this.procesando.set(null);
    }
  }

  private marca(pelicula: Pelicula): number {
    const fecha = this.aFecha(pelicula.fecha_estreno);
    return fecha ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
  }

  private aFecha(valor: string | null): Date | null {
    if (!valor) return null;

    const partes = valor.slice(0, 10).split('-').map(Number);
    if (partes.length !== 3 || partes.some((numero) => !Number.isFinite(numero))) return null;

    return new Date(partes[0], partes[1] - 1, partes[2]);
  }
}
