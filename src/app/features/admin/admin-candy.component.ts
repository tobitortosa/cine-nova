import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CandyService } from '../../core/services/candy.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import {
  CarpetaImagen,
  ImagenesService,
  MAXIMO_MB_IMAGEN,
  PREFIJO_AUTOMATICA,
  TIPOS_IMAGEN,
} from '../../core/services/imagenes.service';
import { GeneradorImagenesService } from '../../core/services/generador-imagenes.service';
import { Categoria, Combo, Producto } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';
import { ImagenRespaldoDirective } from '../../shared/directives/imagen-respaldo.directive';
import { ZonaArchivosDirective } from '../../shared/directives/zona-archivos.directive';
import { entradasIncluidas } from '../../shared/utils/ventas';

type PestaniaCandy = 'categorias' | 'productos' | 'combos';

interface PedidoBaja {
  tipo: PestaniaCandy;
  id: number;
  nombre: string;
  imagen: string | null;
}

interface PedidoAutomatico {
  carpeta: Extract<CarpetaImagen, 'productos' | 'combos'>;
  nombre: string;
  categoria: string | null;
}

interface ImagenAutomatica {
  clave: string;
  imagen: Blob;
}

interface SubidaAutomatica {
  url: string | null;
  motivo: string;
}

const DEMORA_VISTA_MS = 350;

@Component({
  selector: 'app-admin-candy',
  imports: [
    ReactiveFormsModule,
    PrecioPipe,
    CargandoComponent,
    VacioComponent,
    ConfirmarComponent,
    ImagenRespaldoDirective,
    ZonaArchivosDirective,
  ],
  templateUrl: './admin-candy.component.html',
  styleUrl: './admin-candy.component.scss',
})
export class AdminCandyComponent implements OnInit, OnDestroy {
  private readonly candy = inject(CandyService);
  private readonly imagenes = inject(ImagenesService);
  private readonly generador = inject(GeneradorImagenesService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly pestania = signal<PestaniaCandy>('categorias');

  readonly categorias = signal<Categoria[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly combos = signal<Combo[]>([]);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly subiendo = signal(false);
  readonly panelAbierto = signal(false);
  readonly editandoId = signal<number | null>(null);
  readonly filtroCategoria = signal<number>(0);

  readonly archivo = signal<File | null>(null);
  readonly vistaPrevia = signal('');
  readonly errorImagen = signal('');
  readonly generada = signal('');
  readonly maximoMb = MAXIMO_MB_IMAGEN;
  readonly tiposImagen = TIPOS_IMAGEN;
  private readonly imagenAnterior = signal<string | null>(null);
  private claveOriginal: string | null = null;
  private automatica: ImagenAutomatica | null = null;
  private turno = 0;

  readonly confirmando = signal(false);
  readonly textoBaja = signal('');
  private pedido: PedidoBaja | null = null;

  readonly formCategoria = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(60)]],
  });

  readonly formProducto = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    descripcion: ['', [Validators.maxLength(240)]],
    precio: [0, [Validators.required, Validators.min(0)]],
    categoria_id: [''],
    imagen_url: [''],
    activo: [true],
  });

  readonly formCombo = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    descripcion: ['', [Validators.maxLength(240)]],
    precio: [0, [Validators.required, Validators.min(0)]],
    entradas_incluidas: [
      0,
      [Validators.required, Validators.min(0), Validators.max(10), Validators.pattern(/^\d+$/)],
    ],
    imagen_url: [''],
    activo: [true],
  });

  private readonly nombreProducto = toSignal(this.formProducto.controls.nombre.valueChanges, {
    initialValue: this.formProducto.controls.nombre.value,
  });

  private readonly categoriaProducto = toSignal(
    this.formProducto.controls.categoria_id.valueChanges,
    { initialValue: this.formProducto.controls.categoria_id.value },
  );

  private readonly nombreCombo = toSignal(this.formCombo.controls.nombre.valueChanges, {
    initialValue: this.formCombo.controls.nombre.value,
  });

  private readonly pedidoAutomatico = computed<PedidoAutomatico | null>(() => {
    switch (this.pestania()) {
      case 'productos': {
        const categoria = this.nombreCategoriaDe(Number(this.categoriaProducto() || 0));
        return { carpeta: 'productos', nombre: (this.nombreProducto() ?? '').trim(), categoria };
      }
      case 'combos':
        return { carpeta: 'combos', nombre: (this.nombreCombo() ?? '').trim(), categoria: null };
      default:
        return null;
    }
  });

  readonly automaticaGuardada = computed(() => {
    const url = this.vistaPrevia();
    return url !== '' && url === this.imagenAnterior() && this.imagenes.esAutomatica(url);
  });

  readonly productosFiltrados = computed(() => {
    const filtro = this.filtroCategoria();
    if (!filtro) return this.productos();
    return this.productos().filter((producto) => producto.categoria_id === filtro);
  });

  readonly textoBotonAlta = computed(() => {
    switch (this.pestania()) {
      case 'categorias':
        return 'Nueva categoría';
      case 'productos':
        return 'Nuevo producto';
      default:
        return 'Nuevo combo';
    }
  });

  readonly tituloPanel = computed(() => {
    const editando = this.editandoId() !== null;

    switch (this.pestania()) {
      case 'categorias':
        return editando ? 'Editar categoría' : 'Nueva categoría';
      case 'productos':
        return editando ? 'Editar producto' : 'Nuevo producto';
      default:
        return editando ? 'Editar combo' : 'Nuevo combo';
    }
  });

  readonly textoGuardar = computed(() => {
    if (this.subiendo()) return 'Subiendo imagen...';
    return this.guardando() ? 'Guardando...' : 'Guardar';
  });

  constructor() {
    effect((alLimpiar) => {
      const pedido = this.pedidoAutomatico();
      if (!this.panelAbierto() || !pedido || this.vistaPrevia() !== '') return;

      const espera = setTimeout(() => void this.prepararAutomatica(pedido), DEMORA_VISTA_MS);
      alLimpiar(() => clearTimeout(espera));
    });
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  ngOnDestroy(): void {
    this.soltarVista();
    this.descartarAutomatica();
  }

  cambiarPestania(valor: PestaniaCandy): void {
    if (this.guardando()) return;
    this.pestania.set(valor);
    this.cerrar();
  }

  cambiarFiltro(evento: Event): void {
    this.filtroCategoria.set(Number((evento.target as HTMLSelectElement).value));
  }

  cantidadDeCategoria(id: number): number {
    return this.productos().filter((producto) => producto.categoria_id === id).length;
  }

  nombreCategoria(id: number | null): string {
    if (id === null) return 'Sin categoría';
    return this.categorias().find((categoria) => categoria.id === id)?.nombre ?? 'Sin categoría';
  }

  abrirAlta(): void {
    this.editandoId.set(null);
    this.limpiarFormularios();
    this.prepararImagen(null);
    this.panelAbierto.set(true);
  }

  editarCategoria(categoria: Categoria): void {
    this.editandoId.set(categoria.id);
    this.formCategoria.reset({ nombre: categoria.nombre });
    this.prepararImagen(null);
    this.panelAbierto.set(true);
  }

  editarProducto(producto: Producto): void {
    this.editandoId.set(producto.id);
    this.formProducto.reset({
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? '',
      precio: producto.precio,
      categoria_id: producto.categoria_id === null ? '' : String(producto.categoria_id),
      imagen_url: producto.imagen_url ?? '',
      activo: producto.activo,
    });
    this.prepararImagen(
      producto.imagen_url,
      this.claveAutomatica({
        carpeta: 'productos',
        nombre: producto.nombre.trim(),
        categoria: this.nombreCategoriaDe(producto.categoria_id),
      }),
    );
    this.panelAbierto.set(true);
  }

  editarCombo(combo: Combo): void {
    this.editandoId.set(combo.id);
    this.formCombo.reset({
      nombre: combo.nombre,
      descripcion: combo.descripcion ?? '',
      precio: combo.precio,
      entradas_incluidas: this.entradasDe(combo),
      imagen_url: combo.imagen_url ?? '',
      activo: combo.activo,
    });
    this.prepararImagen(
      combo.imagen_url,
      this.claveAutomatica({ carpeta: 'combos', nombre: combo.nombre.trim(), categoria: null }),
    );
    this.panelAbierto.set(true);
  }

  cerrarPanel(): void {
    if (this.guardando()) return;
    this.cerrar();
  }

  elegirArchivo(evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const elegido = campo.files?.[0];
    campo.value = '';

    if (elegido) {
      this.usarArchivo(elegido);
    }
  }

  soltarArchivos(archivos: File[]): void {
    if (archivos.length > 1) {
      this.avisos.info('Soltaste varias imágenes: se usa solo la primera.');
    }
    this.usarArchivo(archivos[0]);
  }

  rechazarArchivo(motivo: string): void {
    if (this.guardando()) return;
    this.errorImagen.set(motivo);
  }

  quitarArchivo(): void {
    if (this.guardando()) return;
    this.escribirUrl(this.controlImagen().value ?? '');
  }

  escribirUrl(valor: string): void {
    this.soltarVista();
    this.archivo.set(null);
    this.errorImagen.set('');
    this.vistaPrevia.set(valor.trim());
  }

  peso(archivo: File): string {
    const kb = archivo.size / 1024;
    if (kb < 1024) {
      return `${Math.max(1, Math.round(kb))} KB`;
    }
    return `${(kb / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;

    switch (this.pestania()) {
      case 'categorias':
        await this.guardarCategoria();
        return;
      case 'productos':
        await this.guardarProducto();
        return;
      default:
        await this.guardarCombo();
    }
  }

  entradasDe(combo: Combo): number {
    return entradasIncluidas(combo);
  }

  textoEntradas(combo: Combo): string {
    const cantidad = this.entradasDe(combo);
    if (cantidad === 0) return 'Sin entradas';
    return cantidad === 1 ? 'Incluye 1 entrada' : `Incluye ${cantidad} entradas`;
  }

  pedirBaja(tipo: PestaniaCandy, id: number, nombre: string, imagen: string | null = null): void {
    this.pedido = { tipo, id, nombre, imagen };
    this.textoBaja.set(this.textoConfirmacionBaja(tipo, nombre));
    this.confirmando.set(true);
  }

  async confirmarBaja(): Promise<void> {
    const pedido = this.pedido;
    if (!pedido) return;

    try {
      if (pedido.tipo === 'categorias') {
        await this.candy.eliminarCategoria(pedido.id);
        this.avisos.exito('Categoría eliminada.');
      } else if (pedido.tipo === 'productos') {
        await this.candy.eliminarProducto(pedido.id);
        this.avisos.exito('Producto eliminado.');
        await this.descartar(pedido.imagen);
      } else {
        await this.candy.eliminarCombo(pedido.id);
        this.avisos.exito('Combo eliminado.');
        await this.descartar(pedido.imagen);
      }

      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.pedido = null;
    }
  }

  private async cargar(): Promise<void> {
    try {
      const [categorias, productos, combos] = await Promise.all([
        this.candy.categorias(),
        this.candy.productos(false),
        this.candy.combos(false),
      ]);

      this.categorias.set(categorias);
      this.productos.set(productos);
      this.combos.set(combos);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.cargando.set(false);
    }
  }

  private async guardarCategoria(): Promise<void> {
    if (this.formCategoria.invalid) {
      this.formCategoria.markAllAsTouched();
      return;
    }

    const nombre = (this.formCategoria.getRawValue().nombre ?? '').trim();
    this.guardando.set(true);

    try {
      const id = this.editandoId();

      if (id === null) {
        await this.candy.crearCategoria(nombre);
        this.avisos.exito('Categoría creada.');
      } else {
        await this.candy.actualizarCategoria(id, nombre);
        this.avisos.exito('Categoría actualizada.');
      }

      this.cerrar();
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.guardando.set(false);
    }
  }

  private async guardarProducto(): Promise<void> {
    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      return;
    }

    const valores = this.formProducto.getRawValue();

    const datos: Partial<Producto> = {
      nombre: (valores.nombre ?? '').trim(),
      descripcion: (valores.descripcion ?? '').trim(),
      precio: Number(valores.precio ?? 0),
      categoria_id: valores.categoria_id ? Number(valores.categoria_id) : null,
      imagen_url: (valores.imagen_url ?? '').trim() || null,
      activo: valores.activo ?? true,
    };

    this.guardando.set(true);
    const anterior = this.imagenAnterior();
    let subida: string | null = null;
    let motivoAutomatica: string | null = null;

    try {
      subida = await this.subirElegida('productos');
      if (!subida && this.necesitaAutomatica(datos.imagen_url ?? null, anterior)) {
        const automatica = await this.subirAutomatica();
        subida = automatica.url;
        motivoAutomatica = subida === null ? automatica.motivo : null;
      }
      if (subida) {
        datos.imagen_url = subida;
      }

      const id = this.editandoId();

      if (id === null) {
        await this.candy.crearProducto(datos);
        this.avisos.exito('Producto creado.');
      } else {
        await this.candy.actualizarProducto(id, datos);
        this.avisos.exito('Producto actualizado.');
      }

      if (motivoAutomatica !== null) {
        this.avisos.info(this.avisoAutomatica(motivoAutomatica, 'El producto', datos.imagen_url));
      }

      this.cerrar();
      await this.descartar(anterior !== datos.imagen_url ? anterior : null);
      await this.cargar();
    } catch (e) {
      await this.descartar(subida);
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.subiendo.set(false);
      this.guardando.set(false);
    }
  }

  private async guardarCombo(): Promise<void> {
    if (this.formCombo.invalid) {
      this.formCombo.markAllAsTouched();
      return;
    }

    const valores = this.formCombo.getRawValue();

    const datos: Partial<Combo> = {
      nombre: (valores.nombre ?? '').trim(),
      descripcion: (valores.descripcion ?? '').trim(),
      precio: Number(valores.precio ?? 0),
      entradas_incluidas: Number(valores.entradas_incluidas ?? 0),
      imagen_url: (valores.imagen_url ?? '').trim() || null,
      activo: valores.activo ?? true,
    };

    this.guardando.set(true);
    const anterior = this.imagenAnterior();
    let subida: string | null = null;
    let motivoAutomatica: string | null = null;

    try {
      subida = await this.subirElegida('combos');
      if (!subida && this.necesitaAutomatica(datos.imagen_url ?? null, anterior)) {
        const automatica = await this.subirAutomatica();
        subida = automatica.url;
        motivoAutomatica = subida === null ? automatica.motivo : null;
      }
      if (subida) {
        datos.imagen_url = subida;
      }

      const id = this.editandoId();

      if (id === null) {
        await this.candy.crearCombo(datos);
        this.avisos.exito('Combo creado.');
      } else {
        await this.candy.actualizarCombo(id, datos);
        this.avisos.exito('Combo actualizado.');
      }

      if (motivoAutomatica !== null) {
        this.avisos.info(this.avisoAutomatica(motivoAutomatica, 'El combo', datos.imagen_url));
      }

      this.cerrar();
      await this.descartar(anterior !== datos.imagen_url ? anterior : null);
      await this.cargar();
    } catch (e) {
      await this.descartar(subida);
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.subiendo.set(false);
      this.guardando.set(false);
    }
  }

  private cerrar(): void {
    this.panelAbierto.set(false);
    this.editandoId.set(null);
    this.prepararImagen(null);
  }

  private controlImagen(): FormControl<string | null> {
    return this.pestania() === 'combos'
      ? this.formCombo.controls.imagen_url
      : this.formProducto.controls.imagen_url;
  }

  private usarArchivo(elegido: File | undefined): void {
    if (!elegido || this.guardando()) return;

    const problema = this.imagenes.validar(elegido);
    if (problema) {
      this.errorImagen.set(problema);
      return;
    }

    this.soltarVista();
    this.archivo.set(elegido);
    this.errorImagen.set('');
    this.vistaPrevia.set(URL.createObjectURL(elegido));
  }

  private soltarVista(): void {
    const actual = this.vistaPrevia();
    if (actual.startsWith('blob:')) {
      URL.revokeObjectURL(actual);
    }
  }

  private prepararImagen(url: string | null, clave: string | null = null): void {
    this.soltarVista();
    this.descartarAutomatica();
    this.archivo.set(null);
    this.errorImagen.set('');
    this.imagenAnterior.set(url);
    this.claveOriginal = clave;
    this.vistaPrevia.set(url ?? '');
  }

  private nombreCategoriaDe(id: number | null): string | null {
    return this.categorias().find((categoria) => categoria.id === id)?.nombre ?? null;
  }

  private necesitaAutomatica(url: string | null, anterior: string | null): boolean {
    if (!url) return true;

    const pedido = this.pedidoAutomatico();
    return (
      pedido !== null &&
      url === anterior &&
      this.imagenes.esAutomatica(anterior) &&
      this.claveOriginal !== null &&
      this.claveAutomatica(pedido) !== this.claveOriginal
    );
  }

  private avisoAutomatica(motivo: string, sujeto: string, url: string | null | undefined): string {
    return url
      ? `No se pudo actualizar la imagen automática: ${motivo} ${sujeto} conserva la imagen anterior.`
      : `No se pudo subir la imagen automática: ${motivo} ${sujeto} quedó sin imagen.`;
  }

  private async subirElegida(carpeta: CarpetaImagen): Promise<string | null> {
    const elegido = this.archivo();
    if (!elegido) return null;

    this.subiendo.set(true);
    try {
      return await this.imagenes.subir(elegido, carpeta);
    } finally {
      this.subiendo.set(false);
    }
  }

  private claveAutomatica(pedido: PedidoAutomatico): string {
    return `${pedido.carpeta}|${pedido.nombre}|${pedido.categoria ?? ''}`;
  }

  private generarAutomatica(pedido: PedidoAutomatico): Promise<Blob> {
    return pedido.carpeta === 'combos'
      ? this.generador.combo(pedido.nombre)
      : this.generador.producto(pedido.nombre, pedido.categoria);
  }

  private async prepararAutomatica(pedido: PedidoAutomatico): Promise<void> {
    const clave = this.claveAutomatica(pedido);
    if (this.automatica?.clave === clave) return;

    const turno = ++this.turno;
    const imagen = await this.generarAutomatica(pedido).catch(() => null);
    if (!imagen || turno !== this.turno || !this.panelAbierto()) return;

    this.soltarAutomatica();
    this.automatica = { clave, imagen };
    this.generada.set(URL.createObjectURL(imagen));
  }

  private async subirAutomatica(): Promise<SubidaAutomatica> {
    const pedido = this.pedidoAutomatico();
    if (!pedido) return { url: null, motivo: 'No se pudo preparar la imagen.' };

    const clave = this.claveAutomatica(pedido);
    const lista = this.automatica;

    this.subiendo.set(true);
    try {
      const imagen = lista?.clave === clave ? lista.imagen : await this.generarAutomatica(pedido);
      const archivo = this.generador.comoArchivo(imagen, pedido.carpeta);
      const url = await this.imagenes.subir(archivo, pedido.carpeta, PREFIJO_AUTOMATICA);
      return { url, motivo: '' };
    } catch (e) {
      return { url: null, motivo: e instanceof Error ? e.message : 'No se pudo subir la imagen.' };
    } finally {
      this.subiendo.set(false);
    }
  }

  private soltarAutomatica(): void {
    const actual = this.generada();
    if (actual) {
      URL.revokeObjectURL(actual);
    }
    this.generada.set('');
    this.automatica = null;
  }

  private descartarAutomatica(): void {
    this.turno++;
    this.soltarAutomatica();
  }

  private async descartar(url: string | null): Promise<void> {
    await this.imagenes.borrarSiNoSeUsa(url).catch(() => false);
  }

  private limpiarFormularios(): void {
    this.formCategoria.reset({ nombre: '' });
    this.formProducto.reset({
      nombre: '',
      descripcion: '',
      precio: 0,
      categoria_id: '',
      imagen_url: '',
      activo: true,
    });
    this.formCombo.reset({
      nombre: '',
      descripcion: '',
      precio: 0,
      entradas_incluidas: 0,
      imagen_url: '',
      activo: true,
    });
  }

  private textoConfirmacionBaja(tipo: PestaniaCandy, nombre: string): string {
    switch (tipo) {
      case 'categorias':
        return `Vas a eliminar la categoría "${nombre}". Sus productos no se borran: quedan sin categoría. Esta acción no se puede deshacer.`;
      case 'productos':
        return `Vas a eliminar "${nombre}" de forma permanente. Si tiene canjes sin usar o es parte de una recompensa activa no se va a poder eliminar: en ese caso desactivalo para que no se venda más.`;
      default:
        return `Vas a eliminar el combo "${nombre}". Las compras que ya lo incluyeron conservan su detalle. Si solo querés dejar de venderlo, desactivalo. Esta acción no se puede deshacer.`;
    }
  }
}
