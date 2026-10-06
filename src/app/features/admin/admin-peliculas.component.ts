import {
  Component,
  OnDestroy,
  OnInit,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PeliculasService } from '../../core/services/peliculas.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import {
  CarpetaImagen,
  ImagenesService,
  MAXIMO_MB_IMAGEN,
  PREFIJO_AUTOMATICA,
  TIPOS_IMAGEN,
} from '../../core/services/imagenes.service';
import { GeneradorImagenesService } from '../../core/services/generador-imagenes.service';
import { Genero, Pelicula } from '../../core/models/modelos';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';
import { CampoFechaComponent } from '../../shared/components/campo-fecha.component';
import { ImagenRespaldoDirective } from '../../shared/directives/imagen-respaldo.directive';
import { ZonaArchivosDirective } from '../../shared/directives/zona-archivos.directive';
import { entradasVendidas } from '../../shared/utils/ventas';

type ImagenPelicula = 'poster' | 'banner';

interface ImagenAutomatica {
  clave: string;
  imagen: Blob;
}

const IMAGENES: readonly ImagenPelicula[] = ['poster', 'banner'];
const CARPETAS: Readonly<Record<ImagenPelicula, CarpetaImagen>> = {
  poster: 'posters',
  banner: 'banners',
};
const DEMORA_VISTA_MS = 350;

@Component({
  selector: 'app-admin-peliculas',
  imports: [
    ReactiveFormsModule,
    DuracionPipe,
    PrecioPipe,
    RestriccionPipe,
    CargandoComponent,
    VacioComponent,
    ConfirmarComponent,
    CampoFechaComponent,
    ImagenRespaldoDirective,
    ZonaArchivosDirective,
  ],
  templateUrl: './admin-peliculas.component.html',
  styleUrl: './admin-peliculas.component.scss',
})
export class AdminPeliculasComponent implements OnInit, OnDestroy {
  private readonly peliculas = inject(PeliculasService);
  private readonly imagenes = inject(ImagenesService);
  private readonly generador = inject(GeneradorImagenesService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly lista = signal<Pelicula[]>([]);
  readonly generos = signal<Genero[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly subiendo = signal(false);
  readonly busqueda = signal('');

  readonly panelAbierto = signal(false);
  readonly editando = signal<Pelicula | null>(null);
  readonly confirmaAbierta = signal(false);
  readonly paraEliminar = signal<Pelicula | null>(null);
  readonly verificandoBaja = signal<number | null>(null);

  readonly restriccion = signal(0);
  readonly generosElegidos = signal<number[]>([]);
  readonly tieneEstreno = signal(false);

  readonly archivo: Record<ImagenPelicula, WritableSignal<File | null>> = {
    poster: signal<File | null>(null),
    banner: signal<File | null>(null),
  };
  readonly vista: Record<ImagenPelicula, WritableSignal<string>> = {
    poster: signal(''),
    banner: signal(''),
  };
  readonly errorImagen: Record<ImagenPelicula, WritableSignal<string>> = {
    poster: signal(''),
    banner: signal(''),
  };
  readonly generada: Record<ImagenPelicula, WritableSignal<string>> = {
    poster: signal(''),
    banner: signal(''),
  };
  private readonly automaticas: Record<ImagenPelicula, ImagenAutomatica | null> = {
    poster: null,
    banner: null,
  };
  private readonly turnos: Record<ImagenPelicula, number> = { poster: 0, banner: 0 };
  private readonly clavesOriginales: Record<ImagenPelicula, string | null> = {
    poster: null,
    banner: null,
  };
  private readonly subidasPendientes = signal(0);

  readonly restricciones: number[] = [0, 13, 18];
  readonly maximoMb = MAXIMO_MB_IMAGEN;
  readonly tiposImagen = TIPOS_IMAGEN;

  readonly formulario = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.maxLength(160)]],
    sinopsis: ['', [Validators.required, Validators.minLength(10)]],
    duracion_min: [100, [Validators.required, Validators.min(1)]],
    imagen_url: [''],
    banner_url: [''],
    fecha_estreno: [''],
    precio_preventa: [0, [Validators.min(0)]],
    en_cartelera: [true],
    destacada: [false],
  });

  private readonly tituloEscrito = toSignal(this.formulario.controls.titulo.valueChanges, {
    initialValue: this.formulario.controls.titulo.value,
  });

  private readonly generoPrincipal = computed(() => this.nombreGenero(this.generosElegidos()[0]));

  readonly automaticaGuardada: Record<ImagenPelicula, Signal<boolean>> = {
    poster: computed(() => this.esAutomaticaGuardada('poster')),
    banner: computed(() => this.esAutomaticaGuardada('banner')),
  };

  readonly visibles = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const todas = this.lista();
    if (!texto) return todas;
    return todas.filter((pelicula) => pelicula.titulo.toLowerCase().includes(texto));
  });

  readonly tituloPanel = computed(() => (this.editando() ? 'Editar película' : 'Nueva película'));

  readonly textoGuardar = computed(() => {
    if (this.subiendo()) {
      return this.subidasPendientes() > 1 ? 'Subiendo imágenes...' : 'Subiendo imagen...';
    }
    return this.guardando() ? 'Guardando...' : 'Guardar película';
  });

  readonly textoConfirmacion = computed(() => {
    const pelicula = this.paraEliminar();
    if (!pelicula) return '';
    return (
      'Se va a eliminar "' +
      pelicula.titulo +
      '" junto con sus funciones y reseñas. Si alguna función ya vendió entradas no se va a poder eliminar: en ese caso sacala de cartelera. Esta acción no se puede deshacer.'
    );
  });

  constructor() {
    this.formulario.controls.fecha_estreno.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.sincronizarPreventa());

    effect((alLimpiar) => {
      if (!this.panelAbierto()) return;

      const titulo = this.tituloEscrito().trim();
      const genero = this.generoPrincipal();
      const faltantes = IMAGENES.filter((tipo) => this.vista[tipo]() === '');
      if (faltantes.length === 0) return;

      const espera = setTimeout(
        () => void this.prepararAutomaticas(faltantes, titulo, genero),
        DEMORA_VISTA_MS,
      );
      alLimpiar(() => clearTimeout(espera));
    });
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  ngOnDestroy(): void {
    for (const tipo of IMAGENES) {
      this.soltarVista(tipo);
      this.descartarAutomatica(tipo);
    }
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [peliculas, generos] = await Promise.all([
        this.peliculas.listar(),
        this.peliculas.generos(),
      ]);
      this.lista.set(peliculas);
      this.generos.set(generos);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar las películas');
    } finally {
      this.cargando.set(false);
    }
  }

  abrirNueva(): void {
    this.editando.set(null);
    this.formulario.reset({
      titulo: '',
      sinopsis: '',
      duracion_min: 100,
      imagen_url: '',
      banner_url: '',
      fecha_estreno: '',
      precio_preventa: 0,
      en_cartelera: true,
      destacada: false,
    });
    this.restriccion.set(0);
    this.generosElegidos.set([]);
    this.reiniciarImagenes(null);
    this.tieneEstreno.set(false);
    this.formulario.controls.precio_preventa.disable();
    this.panelAbierto.set(true);
  }

  abrirEdicion(pelicula: Pelicula): void {
    this.editando.set(pelicula);
    this.formulario.reset({
      titulo: pelicula.titulo,
      sinopsis: pelicula.sinopsis,
      duracion_min: pelicula.duracion_min,
      imagen_url: pelicula.imagen_url ?? '',
      banner_url: pelicula.banner_url ?? '',
      fecha_estreno: pelicula.fecha_estreno ? pelicula.fecha_estreno.slice(0, 10) : '',
      precio_preventa: pelicula.precio_preventa ?? 0,
      en_cartelera: pelicula.en_cartelera,
      destacada: pelicula.destacada,
    });
    this.restriccion.set(pelicula.restriccion_edad);
    this.generosElegidos.set((pelicula.generos ?? []).map((genero) => genero.id));
    this.reiniciarImagenes(pelicula);
    this.sincronizarPreventa();
    this.panelAbierto.set(true);
  }

  cerrarPanel(): void {
    if (this.guardando()) return;
    this.cerrar();
  }

  elegirRestriccion(valor: number): void {
    this.restriccion.set(valor);
  }

  alternarGenero(id: number): void {
    this.generosElegidos.update((actuales) =>
      actuales.includes(id) ? actuales.filter((valor) => valor !== id) : [...actuales, id],
    );
  }

  tieneGenero(id: number): boolean {
    return this.generosElegidos().includes(id);
  }

  elegirArchivo(tipo: ImagenPelicula, evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const elegido = campo.files?.[0];
    campo.value = '';

    if (elegido) {
      this.usarArchivo(tipo, elegido);
    }
  }

  soltarArchivos(tipo: ImagenPelicula, archivos: File[]): void {
    if (archivos.length > 1) {
      this.avisos.info('Soltaste varias imágenes: se usa solo la primera.');
    }
    this.usarArchivo(tipo, archivos[0]);
  }

  rechazarArchivo(tipo: ImagenPelicula, motivo: string): void {
    if (this.guardando()) return;
    this.errorImagen[tipo].set(motivo);
  }

  quitarArchivo(tipo: ImagenPelicula): void {
    if (this.guardando()) return;
    this.escribirUrl(tipo, this.urlEscrita(tipo));
  }

  escribirUrl(tipo: ImagenPelicula, valor: string): void {
    this.soltarVista(tipo);
    this.archivo[tipo].set(null);
    this.errorImagen[tipo].set('');
    this.vista[tipo].set(valor.trim());
  }

  peso(archivo: File): string {
    const kb = archivo.size / 1024;
    if (kb < 1024) {
      return `${Math.max(1, Math.round(kb))} KB`;
    }
    return `${(kb / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
  }

  sincronizarPreventa(): void {
    const hayFecha = (this.formulario.controls.fecha_estreno.value ?? '').trim().length > 0;
    this.tieneEstreno.set(hayFecha);

    if (hayFecha) {
      this.formulario.controls.precio_preventa.enable();
      return;
    }

    this.formulario.controls.precio_preventa.setValue(0);
    this.formulario.controls.precio_preventa.disable();
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.avisos.error('Revisá los campos marcados en rojo');
      return;
    }

    if (this.generosElegidos().length === 0) {
      this.avisos.error('Elegí al menos un género');
      return;
    }

    const valores = this.formulario.getRawValue();
    const fecha = valores.fecha_estreno.trim();
    const preventa = Number(valores.precio_preventa);

    const datos: Partial<Pelicula> = {
      titulo: valores.titulo.trim(),
      sinopsis: valores.sinopsis.trim(),
      duracion_min: Number(valores.duracion_min),
      imagen_url: valores.imagen_url.trim() || null,
      banner_url: valores.banner_url.trim() || null,
      restriccion_edad: this.restriccion(),
      fecha_estreno: fecha || null,
      precio_preventa: fecha && preventa > 0 ? preventa : null,
      en_cartelera: valores.en_cartelera,
      destacada: valores.destacada,
    };

    this.guardando.set(true);
    const actual = this.editando();
    const subidas: string[] = [];
    const genero = this.generoPrincipal();
    const elegidas = IMAGENES.filter((tipo) => this.archivo[tipo]() !== null);
    const automaticas = IMAGENES.filter(
      (tipo) =>
        this.archivo[tipo]() === null &&
        (!this.urlDe(datos, tipo) || this.debeRegenerar(tipo, actual, datos, genero)),
    );
    let motivoBanner: string | null = null;

    this.subidasPendientes.set(elegidas.length + automaticas.length);
    this.subiendo.set(this.subidasPendientes() > 0);

    try {
      for (const tipo of elegidas) {
        const elegido = this.archivo[tipo]();
        if (!elegido) continue;

        const url = await this.imagenes.subir(elegido, CARPETAS[tipo]);
        subidas.push(url);
        this.asignarUrl(datos, tipo, url);
      }

      for (const tipo of automaticas) {
        try {
          const url = await this.subirAutomatica(tipo, datos.titulo ?? '', genero);
          subidas.push(url);
          this.asignarUrl(datos, tipo, url);
        } catch (e) {
          const motivo = e instanceof Error ? e.message : 'No se pudo subir la imagen.';
          if (tipo === 'poster') {
            throw new Error(`No se pudo subir el póster automático: ${motivo}`);
          }
          motivoBanner = motivo;
        }
      }

      this.subiendo.set(false);

      if (actual) {
        await this.peliculas.actualizar(actual.id, datos, this.generosElegidos());
        this.avisos.exito('Película actualizada');
        this.cerrar();
        await this.descartar([
          actual.imagen_url !== datos.imagen_url ? actual.imagen_url : null,
          actual.banner_url !== datos.banner_url ? actual.banner_url : null,
        ]);
      } else {
        await this.peliculas.crear(datos, this.generosElegidos());
        this.avisos.exito('Película creada');
        this.cerrar();
      }

      if (motivoBanner !== null) {
        this.avisos.info(
          datos.banner_url
            ? `No se pudo actualizar el banner automático: ${motivoBanner} La película conserva el banner anterior.`
            : `No se pudo subir el banner automático: ${motivoBanner} La película quedó sin banner; podés agregarlo desde Editar.`,
        );
      }
      await this.cargar();
    } catch (e) {
      await this.descartar(subidas);
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo guardar la película');
    } finally {
      this.subiendo.set(false);
      this.guardando.set(false);
    }
  }

  async pedirBaja(pelicula: Pelicula): Promise<void> {
    if (this.verificandoBaja() !== null) return;

    this.verificandoBaja.set(pelicula.id);
    const vendidas = await this.peliculas.entradasVendidas(pelicula.id);
    this.verificandoBaja.set(null);

    if (vendidas !== null && vendidas > 0) {
      this.avisos.error(
        '"' +
          pelicula.titulo +
          '" tiene ' +
          entradasVendidas(vendidas) +
          ' y no se puede eliminar. Si querés retirarla, sacala de cartelera desde Editar.',
      );
      return;
    }

    this.paraEliminar.set(pelicula);
    this.confirmaAbierta.set(true);
  }

  async eliminar(): Promise<void> {
    const pelicula = this.paraEliminar();
    if (!pelicula) return;

    try {
      await this.peliculas.eliminar(pelicula.id);
      this.avisos.exito('Se eliminó "' + pelicula.titulo + '"');
      await this.descartar([pelicula.imagen_url, pelicula.banner_url]);
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo eliminar la película');
    } finally {
      this.paraEliminar.set(null);
    }
  }

  etiquetaGeneros(pelicula: Pelicula): string {
    const generos = pelicula.generos ?? [];
    return generos.length > 0 ? generos.map((genero) => genero.nombre).join(' · ') : 'Sin géneros';
  }

  private cerrar(): void {
    this.panelAbierto.set(false);
    this.editando.set(null);
    this.reiniciarImagenes(null);
  }

  private usarArchivo(tipo: ImagenPelicula, elegido: File | undefined): void {
    if (!elegido || this.guardando()) return;

    const problema = this.imagenes.validar(elegido);
    if (problema) {
      this.errorImagen[tipo].set(problema);
      return;
    }

    this.soltarVista(tipo);
    this.archivo[tipo].set(elegido);
    this.errorImagen[tipo].set('');
    this.vista[tipo].set(URL.createObjectURL(elegido));
  }

  private soltarVista(tipo: ImagenPelicula): void {
    const actual = this.vista[tipo]();
    if (actual.startsWith('blob:')) {
      URL.revokeObjectURL(actual);
    }
  }

  private reiniciarImagenes(pelicula: Pelicula | null): void {
    for (const tipo of IMAGENES) {
      this.soltarVista(tipo);
      this.descartarAutomatica(tipo);
      this.archivo[tipo].set(null);
      this.errorImagen[tipo].set('');
    }
    this.vista.poster.set(pelicula?.imagen_url ?? '');
    this.vista.banner.set(pelicula?.banner_url ?? '');
    this.guardarClavesOriginales(pelicula);
  }

  private guardarClavesOriginales(pelicula: Pelicula | null): void {
    const titulo = pelicula?.titulo.trim() ?? '';
    const genero = this.nombreGenero(pelicula?.generos?.[0]?.id);

    for (const tipo of IMAGENES) {
      this.clavesOriginales[tipo] = pelicula ? this.claveAutomatica(tipo, titulo, genero) : null;
    }
  }

  private nombreGenero(id: number | undefined): string | null {
    return this.generos().find((genero) => genero.id === id)?.nombre ?? null;
  }

  private esAutomaticaGuardada(tipo: ImagenPelicula): boolean {
    const actual = this.editando();
    const url = this.vista[tipo]();
    return (
      actual !== null && url === (this.urlDe(actual, tipo) ?? '') && this.imagenes.esAutomatica(url)
    );
  }

  private debeRegenerar(
    tipo: ImagenPelicula,
    actual: Pelicula | null,
    datos: Partial<Pelicula>,
    genero: string | null,
  ): boolean {
    const url = this.urlDe(datos, tipo);
    return (
      actual !== null &&
      url === this.urlDe(actual, tipo) &&
      this.imagenes.esAutomatica(url) &&
      this.claveAutomatica(tipo, datos.titulo ?? '', genero) !== this.clavesOriginales[tipo]
    );
  }

  private urlEscrita(tipo: ImagenPelicula): string {
    const control =
      tipo === 'poster' ? this.formulario.controls.imagen_url : this.formulario.controls.banner_url;
    return control.value;
  }

  private urlDe(datos: Partial<Pelicula>, tipo: ImagenPelicula): string | null {
    return (tipo === 'poster' ? datos.imagen_url : datos.banner_url) ?? null;
  }

  private asignarUrl(datos: Partial<Pelicula>, tipo: ImagenPelicula, url: string): void {
    if (tipo === 'poster') {
      datos.imagen_url = url;
    } else {
      datos.banner_url = url;
    }
  }

  private claveAutomatica(tipo: ImagenPelicula, titulo: string, genero: string | null): string {
    return tipo === 'poster' ? `${titulo}|${genero ?? ''}` : titulo;
  }

  private generarAutomatica(
    tipo: ImagenPelicula,
    titulo: string,
    genero: string | null,
  ): Promise<Blob> {
    return tipo === 'poster'
      ? this.generador.poster(titulo, genero)
      : this.generador.banner(titulo);
  }

  private async prepararAutomaticas(
    tipos: ImagenPelicula[],
    titulo: string,
    genero: string | null,
  ): Promise<void> {
    for (const tipo of tipos) {
      const clave = this.claveAutomatica(tipo, titulo, genero);
      if (this.automaticas[tipo]?.clave === clave) continue;

      const turno = ++this.turnos[tipo];
      const imagen = await this.generarAutomatica(tipo, titulo, genero).catch(() => null);
      if (!imagen || turno !== this.turnos[tipo] || !this.panelAbierto()) continue;

      this.soltarAutomatica(tipo);
      this.automaticas[tipo] = { clave, imagen };
      this.generada[tipo].set(URL.createObjectURL(imagen));
    }
  }

  private async subirAutomatica(
    tipo: ImagenPelicula,
    titulo: string,
    genero: string | null,
  ): Promise<string> {
    const clave = this.claveAutomatica(tipo, titulo, genero);
    const lista = this.automaticas[tipo];
    const imagen =
      lista?.clave === clave ? lista.imagen : await this.generarAutomatica(tipo, titulo, genero);

    return this.imagenes.subir(
      this.generador.comoArchivo(imagen, tipo),
      CARPETAS[tipo],
      PREFIJO_AUTOMATICA,
    );
  }

  private soltarAutomatica(tipo: ImagenPelicula): void {
    const actual = this.generada[tipo]();
    if (actual) {
      URL.revokeObjectURL(actual);
    }
    this.generada[tipo].set('');
    this.automaticas[tipo] = null;
  }

  private descartarAutomatica(tipo: ImagenPelicula): void {
    this.turnos[tipo]++;
    this.soltarAutomatica(tipo);
  }

  private async descartar(urls: (string | null)[]): Promise<void> {
    await Promise.allSettled(urls.map((url) => this.imagenes.borrarSiNoSeUsa(url)));
  }
}
