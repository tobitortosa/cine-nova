import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { PeliculasService } from '../../core/services/peliculas.service';
import { FuncionesService } from '../../core/services/funciones.service';
import { LARGO_MAXIMO_RESENIA, ReseniasService } from '../../core/services/resenias.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Funcion, Pelicula, Resenia } from '../../core/models/modelos';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { DesdePipe } from '../../shared/pipes/desde.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { EstrellasComponent } from '../../shared/components/estrellas.component';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import {
  DIAS_PREVENTA,
  finDePreventa,
  hoyLocal,
  preventaVigente,
  sumarDias,
  tienePreventa,
  ventaAbierta,
} from '../../shared/utils/ventas';

const TITULO_NO_ENCONTRADA = 'Película no encontrada · CineNova';

interface GrupoFunciones {
  clave: string;
  etiqueta: string;
  fecha: string;
  funciones: Funcion[];
}

@Component({
  selector: 'app-detalle-pelicula',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    DuracionPipe,
    RestriccionPipe,
    DesdePipe,
    PrecioPipe,
    EstrellasComponent,
    CargandoComponent,
    VacioComponent,
  ],
  templateUrl: './detalle-pelicula.component.html',
  styleUrl: './detalle-pelicula.component.scss',
})
export class DetallePeliculaComponent {
  private readonly peliculas = inject(PeliculasService);
  private readonly funcionesServicio = inject(FuncionesService);
  private readonly reseniasServicio = inject(ReseniasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly titulo = inject(Title);
  private readonly fb = inject(FormBuilder);
  private readonly ruta = inject(ActivatedRoute);
  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  readonly auth = inject(AuthService);

  readonly id = input<string>('');

  readonly pelicula = signal<Pelicula | null>(null);
  readonly funciones = signal<Funcion[]>([]);
  readonly resenias = signal<Resenia[]>([]);
  readonly miResenia = signal<Resenia | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly puntaje = signal(0);
  readonly largo = signal(0);
  readonly huboFunciones = signal(false);

  readonly maximo = LARGO_MAXIMO_RESENIA;

  readonly formulario = this.fb.nonNullable.group({
    estrellas: [0, [Validators.required, Validators.min(1)]],
    comentario: ['', [Validators.maxLength(LARGO_MAXIMO_RESENIA)]],
  });

  readonly promedio = computed(() => {
    const lista = this.resenias();
    if (lista.length === 0) return 0;
    const suma = lista.reduce((acumulado, resenia) => acumulado + resenia.estrellas, 0);
    return Math.round((suma / lista.length) * 10) / 10;
  });

  readonly totalResenias = computed(() => this.resenias().length);

  readonly miUsuario = computed(() => this.auth.perfil()?.id ?? '');

  readonly estrenada = computed(() => {
    const pelicula = this.pelicula();
    if (!pelicula) return false;
    if (pelicula.en_cartelera || this.huboFunciones()) return true;
    const estreno = pelicula.fecha_estreno?.slice(0, 10);
    return !!estreno && estreno <= hoyLocal();
  });

  readonly volverAPelicula = computed(() => ({
    volverA: `/peliculas/${this.pelicula()?.id ?? this.id()}`,
  }));

  readonly ventaHabilitada = computed(() => ventaAbierta(this.pelicula()));

  readonly enPreventa = computed(() => preventaVigente(this.pelicula()));

  readonly conPreventa = computed(() => tienePreventa(this.pelicula()));

  readonly estreno = computed(() => {
    const fecha = this.pelicula()?.fecha_estreno;
    return fecha ? this.fechaSimple(fecha) : '';
  });

  readonly finPreventa = computed(() => {
    const fin = finDePreventa(this.pelicula());
    return fin ? this.fechaSimple(fin) : '';
  });

  readonly aperturaVenta = computed(() => {
    const fecha = this.pelicula()?.fecha_estreno;
    if (!fecha) return '';
    return this.fechaSimple(sumarDias(fecha, this.conPreventa() ? -DIAS_PREVENTA : 0));
  });

  readonly grupos = computed<GrupoFunciones[]>(() => {
    const mapa = new Map<string, Funcion[]>();

    for (const funcion of this.funciones()) {
      const clave = this.claveDia(new Date(funcion.inicio));
      const actuales = mapa.get(clave) ?? [];
      actuales.push(funcion);
      mapa.set(clave, actuales);
    }

    return [...mapa.entries()].map(([clave, funciones]) => ({
      clave,
      etiqueta: this.etiquetaDia(clave),
      fecha: this.fechaLarga(clave),
      funciones,
    }));
  });

  constructor() {
    effect(() => {
      const identificador = Number(this.id());
      void this.cargar(identificador);
    });
  }

  hora(funcion: Funcion): string {
    return new Date(funcion.inicio).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  elegirPuntaje(valor: number): void {
    this.puntaje.set(valor);
    this.formulario.controls.estrellas.setValue(valor);
    this.formulario.controls.estrellas.markAsTouched();
    this.formulario.markAsDirty();
  }

  alEscribirComentario(evento: Event): void {
    this.largo.set((evento.target as HTMLTextAreaElement).value.length);
  }

  async guardarResenia(): Promise<void> {
    const pelicula = this.pelicula();
    if (!pelicula) return;

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.avisos.error('Elegí un puntaje de 1 a 5 estrellas');
      return;
    }

    const { estrellas, comentario } = this.formulario.getRawValue();
    this.guardando.set(true);

    try {
      await this.reseniasServicio.guardar(pelicula.id, estrellas, comentario);
      await this.traerResenias(pelicula.id);
      this.avisos.exito('Guardamos tu reseña');
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo guardar la reseña');
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminarResenia(): Promise<void> {
    const mia = this.miResenia();
    const pelicula = this.pelicula();
    if (!mia || !pelicula) return;

    this.guardando.set(true);

    try {
      await this.reseniasServicio.eliminar(mia.id);
      await this.traerResenias(pelicula.id);
      this.avisos.exito('Borramos tu reseña');
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo borrar la reseña');
    } finally {
      this.guardando.set(false);
    }
  }

  private async cargar(id: number): Promise<void> {
    this.cargando.set(true);
    this.pelicula.set(null);
    this.funciones.set([]);
    this.resenias.set([]);
    this.huboFunciones.set(false);

    if (!Number.isFinite(id) || id <= 0) {
      this.titulo.setTitle(TITULO_NO_ENCONTRADA);
      this.cargando.set(false);
      return;
    }

    try {
      const pelicula = await this.peliculas.obtener(id);
      this.pelicula.set(pelicula);

      if (!pelicula) {
        this.titulo.setTitle(TITULO_NO_ENCONTRADA);
        this.cargando.set(false);
        return;
      }

      this.titulo.setTitle(`${pelicula.titulo} · CineNova`);

      const funciones = await this.funcionesServicio.porPelicula(id);
      this.funciones.set(funciones);

      if (!this.estrenada()) this.huboFunciones.set(await this.funcionesServicio.empezoAlguna(id));

      await this.traerResenias(id);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo cargar la película');
    } finally {
      this.cargando.set(false);
      this.irAlAncla();
    }
  }

  private irAlAncla(): void {
    const ancla = this.ruta.snapshot.fragment;
    if (!ancla || this.destroyRef.destroyed) return;

    afterNextRender(
      () => {
        const destino = this.anfitrion.nativeElement.ownerDocument.getElementById(ancla);
        destino?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      { injector: this.injector },
    );
  }

  private async traerResenias(id: number): Promise<void> {
    this.resenias.set(await this.reseniasServicio.porPelicula(id));

    const mia = await this.reseniasServicio.miResenia(id);
    this.miResenia.set(mia);

    this.formulario.reset({
      estrellas: mia?.estrellas ?? 0,
      comentario: mia?.comentario ?? '',
    });
    this.puntaje.set(mia?.estrellas ?? 0);
    this.largo.set((mia?.comentario ?? '').length);
  }

  private claveDia(fecha: Date): string {
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
  }

  private aFecha(clave: string): Date {
    const [anio, mes, dia] = clave.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
  }

  private etiquetaDia(clave: string): string {
    const hoy = new Date();
    const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

    if (clave === this.claveDia(hoy)) return 'Hoy';
    if (clave === this.claveDia(manana)) return 'Mañana';

    const texto = new Intl.DateTimeFormat('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(this.aFecha(clave));

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  private fechaSimple(valor: string): string {
    const fecha = this.aFecha(valor.slice(0, 10));
    const opciones: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    if (fecha.getFullYear() !== new Date().getFullYear()) opciones.year = 'numeric';
    return new Intl.DateTimeFormat('es-AR', opciones).format(fecha);
  }

  private fechaLarga(clave: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(this.aFecha(clave));
  }
}
