import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeliculasService } from '../../core/services/peliculas.service';
import { CandyService } from '../../core/services/candy.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Combo, Pelicula, PeliculaVendida } from '../../core/models/modelos';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { EstrellasComponent } from '../../shared/components/estrellas.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { diasHasta, entradasVendidas, preventaVigente } from '../../shared/utils/ventas';

interface Estreno {
  pelicula: Pelicula;
  fecha: string;
  cuenta: string;
  preventa: boolean;
}

interface Diapositiva {
  pelicula: Pelicula;
  puesto: number | null;
  vendidas: number;
}

const ROTACION_MS = 7000;
const LARGO_SINOPSIS = 240;
const TOPE_DESTACADAS = 5;

@Component({
  selector: 'app-home',
  imports: [RouterLink, DuracionPipe, PrecioPipe, RestriccionPipe, EstrellasComponent, VacioComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly peliculas = inject(PeliculasService);
  private readonly candy = inject(CandyService);
  private readonly avisos = inject(NotificacionesService);

  private temporizador: ReturnType<typeof setInterval> | null = null;
  private readonly formatoLargo = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  readonly cartelera = signal<Pelicula[]>([]);
  readonly vendidas = signal<PeliculaVendida[]>([]);
  readonly proximos = signal<Pelicula[]>([]);
  readonly combos = signal<Combo[]>([]);
  readonly cargando = signal(true);
  readonly indice = signal(0);

  readonly esqueletos: number[] = [1, 2, 3, 4, 5, 6];
  readonly esqueletosCortos: number[] = [1, 2, 3];

  readonly diapositivas = computed<Diapositiva[]>(() => {
    const lista = this.cartelera();
    const porId = new Map(lista.map((pelicula) => [pelicula.id, pelicula]));

    const ranking: Diapositiva[] = [];
    this.vendidas().forEach((fila, posicion) => {
      const pelicula = porId.get(fila.pelicula_id);
      if (pelicula) ranking.push({ pelicula, puesto: posicion + 1, vendidas: fila.vendidas });
    });

    const incluidas = new Set(ranking.map((diapositiva) => diapositiva.pelicula.id));
    const marcadas = lista
      .filter((pelicula) => pelicula.destacada && !incluidas.has(pelicula.id))
      .slice(0, TOPE_DESTACADAS);
    const respaldo = ranking.length === 0 && marcadas.length === 0 ? lista.slice(0, 3) : [];

    return [
      ...ranking,
      ...[...marcadas, ...respaldo].map((pelicula) => ({ pelicula, puesto: null, vendidas: 0 })),
    ];
  });

  readonly actual = computed<Diapositiva | null>(() => {
    const lista = this.diapositivas();
    if (lista.length === 0) return null;
    return lista[this.indice() % lista.length];
  });

  readonly heroe = computed<Pelicula | null>(() => this.actual()?.pelicula ?? null);

  readonly heroeLista = computed<Pelicula[]>(() => {
    const actual = this.heroe();
    return actual ? [actual] : [];
  });

  readonly sinopsisHeroe = computed<string>(() => {
    const texto = (this.heroe()?.sinopsis ?? '').trim();
    if (texto.length <= LARGO_SINOPSIS) return texto;
    return `${texto.slice(0, LARGO_SINOPSIS).trimEnd()}…`;
  });

  readonly generosHeroe = computed<string[]>(() =>
    (this.heroe()?.generos ?? []).slice(0, 3).map((genero) => genero.nombre),
  );

  readonly estrenos = computed<Estreno[]>(() =>
    this.proximos().map((pelicula) => ({
      pelicula,
      fecha: this.textoFecha(pelicula.fecha_estreno),
      cuenta: this.textoCuenta(diasHasta(pelicula.fecha_estreno)),
      preventa: preventaVigente(pelicula),
    })),
  );

  readonly combosDestacados = computed<Combo[]>(() => this.combos().slice(0, 2));

  async ngOnInit(): Promise<void> {
    try {
      const [cartelera, vendidas, proximos, combos] = await Promise.all([
        this.peliculas.listar({ enCartelera: true }),
        this.peliculas.masVendidas(3, 30).catch((): PeliculaVendida[] => []),
        this.peliculas.proximosEstrenos(),
        this.candy.combos(true),
      ]);

      this.cartelera.set(cartelera);
      this.vendidas.set(vendidas);
      this.proximos.set(proximos);
      this.combos.set(combos);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo cargar la portada');
    } finally {
      this.cargando.set(false);
      this.arrancarRotacion();
    }
  }

  ngOnDestroy(): void {
    this.detenerRotacion();
  }

  elegirDestacada(posicion: number): void {
    this.indice.set(posicion);
    this.arrancarRotacion();
  }

  desplazar(pista: HTMLElement, direccion: number): void {
    const paso = Math.max(240, Math.round(pista.clientWidth * 0.8));
    pista.scrollBy({ left: direccion * paso, behavior: 'smooth' });
  }

  portada(pelicula: Pelicula): string | null {
    return pelicula.imagen_url ?? pelicula.banner_url ?? null;
  }

  fondo(pelicula: Pelicula): string | null {
    return pelicula.banner_url ?? pelicula.imagen_url ?? null;
  }

  inicial(titulo: string): string {
    const limpio = (titulo ?? '').trim();
    return limpio.length > 0 ? limpio.charAt(0).toUpperCase() : '?';
  }

  encabezado(diapositiva: Diapositiva): string {
    if (diapositiva.puesto === 1) return 'La más vendida';
    if (diapositiva.puesto !== null) return `Top ${diapositiva.puesto} en ventas`;
    return diapositiva.pelicula.destacada ? 'Destacada' : 'En cartelera';
  }

  textoVendidas(vendidas: number): string {
    return entradasVendidas(Number(vendidas) || 0);
  }

  textoVentas(vendidas: number): string {
    return `${this.textoVendidas(vendidas)} en los últimos 30 días`;
  }

  etiquetaIndicador(diapositiva: Diapositiva): string {
    const titulo = diapositiva.pelicula.titulo;
    return diapositiva.puesto !== null
      ? `Ver ${titulo}, puesto ${diapositiva.puesto} en ventas`
      : `Ver ${titulo}`;
  }

  private arrancarRotacion(): void {
    this.detenerRotacion();
    if (this.diapositivas().length < 2) return;
    this.temporizador = setInterval(() => this.avanzar(), ROTACION_MS);
  }

  private detenerRotacion(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }

  private avanzar(): void {
    const total = this.diapositivas().length;
    if (total < 2) return;
    this.indice.update((actual) => (actual + 1) % total);
  }

  private aFecha(valor: string | null): Date | null {
    if (!valor) return null;
    const partes = valor.slice(0, 10).split('-').map((parte) => Number(parte));
    if (partes.length !== 3 || partes.some((parte) => !Number.isFinite(parte))) return null;
    const fecha = new Date(partes[0], partes[1] - 1, partes[2]);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  private textoFecha(valor: string | null): string {
    const fecha = this.aFecha(valor);
    return fecha ? this.formatoLargo.format(fecha) : 'Fecha a confirmar';
  }

  private textoCuenta(dias: number | null): string {
    if (dias === null) return 'Fecha a confirmar';
    if (dias < 0) return 'Llega muy pronto';
    if (dias === 0) return 'Se estrena hoy';
    if (dias === 1) return 'Se estrena mañana';
    return `Faltan ${dias} días`;
  }
}
