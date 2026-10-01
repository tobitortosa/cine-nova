import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { PeliculasService } from '../../core/services/peliculas.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Genero, Pelicula } from '../../core/models/modelos';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { EstrellasComponent } from '../../shared/components/estrellas.component';
import { VacioComponent } from '../../shared/components/vacio.component';

@Component({
  selector: 'app-cartelera',
  imports: [RouterLink, DuracionPipe, RestriccionPipe, EstrellasComponent, VacioComponent],
  templateUrl: './cartelera.component.html',
  styleUrl: './cartelera.component.scss',
})
export class CarteleraComponent implements OnInit, OnDestroy {
  private readonly peliculas = inject(PeliculasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly lista = signal<Pelicula[]>([]);
  readonly generos = signal<Genero[]>([]);
  readonly texto = signal('');
  readonly busqueda = signal('');
  readonly generoId = signal<number | null>(null);
  readonly cargando = signal(true);

  readonly esqueletos = [1, 2, 3, 4, 5, 6, 7, 8];

  readonly hayFiltros = computed(
    () => this.busqueda().trim().length > 0 || this.generoId() !== null,
  );

  readonly resumen = computed(() => {
    const total = this.lista().length;
    if (this.hayFiltros()) {
      return total === 1 ? '1 resultado' : `${total} resultados`;
    }
    return total === 1 ? '1 película en cartelera' : `${total} películas en cartelera`;
  });

  readonly generoElegido = computed(() => {
    const elegido = this.generoId();
    if (elegido === null) return '';
    return this.generos().find((genero) => genero.id === elegido)?.nombre ?? '';
  });

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private suscripcion: Subscription | null = null;
  private iniciado = false;

  async ngOnInit(): Promise<void> {
    this.suscripcion = this.ruta.queryParamMap.subscribe((parametros) => {
      const valor = (parametros.get('busqueda') ?? '').trim();

      if (!this.iniciado) {
        this.iniciado = true;
        this.texto.set(valor);
        this.busqueda.set(valor);
        void this.cargar();
        return;
      }

      if (valor === this.busqueda()) return;

      this.texto.set(valor);
      this.busqueda.set(valor);
      void this.cargar();
    });

    try {
      this.generos.set(await this.peliculas.generos());
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar los géneros');
    }
  }

  ngOnDestroy(): void {
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.suscripcion?.unsubscribe();
  }

  alEscribir(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.texto.set(valor);

    if (this.temporizador !== null) clearTimeout(this.temporizador);

    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.aplicarBusqueda(valor.trim());
    }, 300);
  }

  limpiarBusqueda(): void {
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.texto.set('');
    this.aplicarBusqueda('');
  }

  limpiarTodo(): void {
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.generoId.set(null);
    this.texto.set('');

    if (this.busqueda().length > 0) {
      this.aplicarBusqueda('');
      return;
    }

    void this.cargar();
  }

  elegirGenero(id: number | null): void {
    if (this.generoId() === id) return;
    this.generoId.set(id);
    void this.cargar();
  }

  private aplicarBusqueda(valor: string): void {
    if (valor === this.busqueda()) return;

    this.busqueda.set(valor);

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { busqueda: valor.length > 0 ? valor : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    void this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);

    try {
      const peliculas = await this.peliculas.listar({
        enCartelera: true,
        busqueda: this.busqueda(),
        generoId: this.generoId(),
      });
      this.lista.set(peliculas);
    } catch (e) {
      this.lista.set([]);
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar las películas');
    } finally {
      this.cargando.set(false);
    }
  }
}
