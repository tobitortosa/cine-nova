import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CandyService } from '../../core/services/candy.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Categoria, Combo, Producto } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

type PestaniaCandy = 'categorias' | 'productos' | 'combos';

interface PedidoBaja {
  tipo: PestaniaCandy;
  id: number;
  nombre: string;
}

@Component({
  selector: 'app-admin-candy',
  imports: [ReactiveFormsModule, PrecioPipe, CargandoComponent, VacioComponent, ConfirmarComponent],
  templateUrl: './admin-candy.component.html',
  styleUrl: './admin-candy.component.scss',
})
export class AdminCandyComponent implements OnInit {
  private readonly candy = inject(CandyService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly pestania = signal<PestaniaCandy>('categorias');

  readonly categorias = signal<Categoria[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly combos = signal<Combo[]>([]);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly panelAbierto = signal(false);
  readonly editandoId = signal<number | null>(null);
  readonly filtroCategoria = signal<number>(0);

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
    imagen_url: [''],
    activo: [true],
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

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  cambiarPestania(valor: PestaniaCandy): void {
    this.pestania.set(valor);
    this.cerrarPanel();
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
    this.panelAbierto.set(true);
  }

  editarCategoria(categoria: Categoria): void {
    this.editandoId.set(categoria.id);
    this.formCategoria.reset({ nombre: categoria.nombre });
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
    this.panelAbierto.set(true);
  }

  editarCombo(combo: Combo): void {
    this.editandoId.set(combo.id);
    this.formCombo.reset({
      nombre: combo.nombre,
      descripcion: combo.descripcion ?? '',
      precio: combo.precio,
      imagen_url: combo.imagen_url ?? '',
      activo: combo.activo,
    });
    this.panelAbierto.set(true);
  }

  cerrarPanel(): void {
    this.panelAbierto.set(false);
    this.editandoId.set(null);
  }

  async guardar(): Promise<void> {
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

  pedirBaja(tipo: PestaniaCandy, id: number, nombre: string): void {
    this.pedido = { tipo, id, nombre };
    this.textoBaja.set(`Vas a eliminar "${nombre}" de forma permanente. Esta acción no se puede deshacer.`);
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
      } else {
        await this.candy.eliminarCombo(pedido.id);
        this.avisos.exito('Combo eliminado.');
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

      this.cerrarPanel();
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

    try {
      const id = this.editandoId();

      if (id === null) {
        await this.candy.crearProducto(datos);
        this.avisos.exito('Producto creado.');
      } else {
        await this.candy.actualizarProducto(id, datos);
        this.avisos.exito('Producto actualizado.');
      }

      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
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
      imagen_url: (valores.imagen_url ?? '').trim() || null,
      activo: valores.activo ?? true,
    };

    this.guardando.set(true);

    try {
      const id = this.editandoId();

      if (id === null) {
        await this.candy.crearCombo(datos);
        this.avisos.exito('Combo creado.');
      } else {
        await this.candy.actualizarCombo(id, datos);
        this.avisos.exito('Combo actualizado.');
      }

      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.guardando.set(false);
    }
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
      imagen_url: '',
      activo: true,
    });
  }
}
