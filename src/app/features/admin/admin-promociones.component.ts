import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PromocionesService } from '../../core/services/promociones.service';
import { CandyService } from '../../core/services/candy.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Cupon, Producto, Recompensa, TipoCupon, TipoRecompensa } from '../../core/models/modelos';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

type PestaniaPromocion = 'cupones' | 'recompensas';

interface PedidoBaja {
  tipo: PestaniaPromocion;
  id: number;
  nombre: string;
}

@Component({
  selector: 'app-admin-promociones',
  imports: [ReactiveFormsModule, CargandoComponent, VacioComponent, ConfirmarComponent],
  templateUrl: './admin-promociones.component.html',
  styleUrl: './admin-promociones.component.scss',
})
export class AdminPromocionesComponent implements OnInit {
  private readonly promociones = inject(PromocionesService);
  private readonly candy = inject(CandyService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly pestania = signal<PestaniaPromocion>('cupones');

  readonly cupones = signal<Cupon[]>([]);
  readonly recompensas = signal<Recompensa[]>([]);
  readonly productos = signal<Producto[]>([]);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly panelAbierto = signal(false);
  readonly editandoId = signal<number | null>(null);

  readonly tipoCupon = signal<TipoCupon>('bienvenida');
  readonly tipoRecompensa = signal<TipoRecompensa>('entrada');

  readonly confirmando = signal(false);
  readonly textoBaja = signal('');
  private pedido: PedidoBaja | null = null;

  readonly formCupon = this.fb.group({
    codigo: ['', [Validators.required, Validators.maxLength(24)]],
    descripcion: ['', [Validators.required, Validators.maxLength(160)]],
    porcentaje: [10, [Validators.required, Validators.min(1), Validators.max(100)]],
    tipo: ['bienvenida'],
    edad_minima: [null as number | null],
    activo: [true],
  });

  readonly formRecompensa = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    tipo: ['entrada'],
    producto_id: [''],
    costo_puntos: [100, [Validators.required, Validators.min(1)]],
    activo: [true],
  });

  readonly textoBotonAlta = computed(() =>
    this.pestania() === 'cupones' ? 'Nuevo cupón' : 'Nueva recompensa',
  );

  readonly tituloPanel = computed(() => {
    const editando = this.editandoId() !== null;

    if (this.pestania() === 'cupones') {
      return editando ? 'Editar cupón' : 'Nuevo cupón';
    }

    return editando ? 'Editar recompensa' : 'Nueva recompensa';
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  cambiarPestania(valor: PestaniaPromocion): void {
    this.pestania.set(valor);
    this.cerrarPanel();
  }

  etiquetaTipoCupon(tipo: TipoCupon): string {
    return tipo === 'bienvenida' ? 'Bienvenida' : 'Por edad';
  }

  etiquetaTipoRecompensa(tipo: TipoRecompensa): string {
    return tipo === 'entrada' ? 'Entrada' : 'Producto';
  }

  nombreProducto(id: number | null): string {
    if (id === null) return 'Sin producto';
    return this.productos().find((producto) => producto.id === id)?.nombre ?? 'Producto eliminado';
  }

  elegirTipoCupon(tipo: TipoCupon): void {
    this.tipoCupon.set(tipo);
    this.formCupon.controls.tipo.setValue(tipo);

    const edad = this.formCupon.controls.edad_minima;

    if (tipo === 'edad') {
      edad.setValidators([Validators.required, Validators.min(1), Validators.max(120)]);
    } else {
      edad.clearValidators();
      edad.setValue(null);
    }

    edad.updateValueAndValidity();
  }

  elegirTipoRecompensa(tipo: TipoRecompensa): void {
    this.tipoRecompensa.set(tipo);
    this.formRecompensa.controls.tipo.setValue(tipo);

    const producto = this.formRecompensa.controls.producto_id;

    if (tipo === 'producto') {
      producto.setValidators([Validators.required]);
    } else {
      producto.clearValidators();
      producto.setValue('');
    }

    producto.updateValueAndValidity();
  }

  abrirAlta(): void {
    this.editandoId.set(null);

    this.formCupon.reset({
      codigo: '',
      descripcion: '',
      porcentaje: 10,
      tipo: 'bienvenida',
      edad_minima: null,
      activo: true,
    });
    this.elegirTipoCupon('bienvenida');

    this.formRecompensa.reset({
      nombre: '',
      tipo: 'entrada',
      producto_id: '',
      costo_puntos: 100,
      activo: true,
    });
    this.elegirTipoRecompensa('entrada');

    this.panelAbierto.set(true);
  }

  editarCupon(cupon: Cupon): void {
    this.editandoId.set(cupon.id);
    this.formCupon.reset({
      codigo: cupon.codigo,
      descripcion: cupon.descripcion ?? '',
      porcentaje: cupon.porcentaje,
      tipo: cupon.tipo,
      edad_minima: cupon.edad_minima,
      activo: cupon.activo,
    });
    this.tipoCupon.set(cupon.tipo);

    const edad = this.formCupon.controls.edad_minima;

    if (cupon.tipo === 'edad') {
      edad.setValidators([Validators.required, Validators.min(1), Validators.max(120)]);
    } else {
      edad.clearValidators();
    }

    edad.updateValueAndValidity();
    this.panelAbierto.set(true);
  }

  editarRecompensa(recompensa: Recompensa): void {
    this.editandoId.set(recompensa.id);
    this.formRecompensa.reset({
      nombre: recompensa.nombre,
      tipo: recompensa.tipo,
      producto_id: recompensa.producto_id === null ? '' : String(recompensa.producto_id),
      costo_puntos: recompensa.costo_puntos,
      activo: recompensa.activo,
    });
    this.tipoRecompensa.set(recompensa.tipo);

    const producto = this.formRecompensa.controls.producto_id;

    if (recompensa.tipo === 'producto') {
      producto.setValidators([Validators.required]);
    } else {
      producto.clearValidators();
    }

    producto.updateValueAndValidity();
    this.panelAbierto.set(true);
  }

  cerrarPanel(): void {
    this.panelAbierto.set(false);
    this.editandoId.set(null);
  }

  async guardar(): Promise<void> {
    if (this.pestania() === 'cupones') {
      await this.guardarCupon();
      return;
    }

    await this.guardarRecompensa();
  }

  pedirBaja(tipo: PestaniaPromocion, id: number, nombre: string): void {
    this.pedido = { tipo, id, nombre };
    this.textoBaja.set(`Vas a eliminar "${nombre}" de forma permanente. Esta acción no se puede deshacer.`);
    this.confirmando.set(true);
  }

  async confirmarBaja(): Promise<void> {
    const pedido = this.pedido;
    if (!pedido) return;

    try {
      if (pedido.tipo === 'cupones') {
        await this.promociones.eliminarCupon(pedido.id);
        this.avisos.exito('Cupón eliminado.');
      } else {
        await this.promociones.eliminarRecompensa(pedido.id);
        this.avisos.exito('Recompensa eliminada.');
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
      const [cupones, recompensas, productos] = await Promise.all([
        this.promociones.cupones(),
        this.promociones.recompensas(false),
        this.candy.productos(false),
      ]);

      this.cupones.set(cupones);
      this.recompensas.set(recompensas);
      this.productos.set(productos);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.cargando.set(false);
    }
  }

  private async guardarCupon(): Promise<void> {
    if (this.formCupon.invalid) {
      this.formCupon.markAllAsTouched();
      return;
    }

    const valores = this.formCupon.getRawValue();
    const tipo = (valores.tipo ?? 'bienvenida') as TipoCupon;

    const datos: Partial<Cupon> = {
      codigo: (valores.codigo ?? '').trim().toUpperCase(),
      descripcion: (valores.descripcion ?? '').trim(),
      porcentaje: Number(valores.porcentaje ?? 0),
      tipo,
      edad_minima: tipo === 'edad' ? Number(valores.edad_minima ?? 0) : null,
      activo: valores.activo ?? true,
    };

    this.guardando.set(true);

    try {
      const id = this.editandoId();

      if (id === null) {
        await this.promociones.crearCupon(datos);
        this.avisos.exito('Cupón creado.');
      } else {
        await this.promociones.actualizarCupon(id, datos);
        this.avisos.exito('Cupón actualizado.');
      }

      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.guardando.set(false);
    }
  }

  private async guardarRecompensa(): Promise<void> {
    if (this.formRecompensa.invalid) {
      this.formRecompensa.markAllAsTouched();
      return;
    }

    const valores = this.formRecompensa.getRawValue();
    const tipo = (valores.tipo ?? 'entrada') as TipoRecompensa;

    const datos: Partial<Recompensa> = {
      nombre: (valores.nombre ?? '').trim(),
      tipo,
      producto_id: tipo === 'producto' && valores.producto_id ? Number(valores.producto_id) : null,
      costo_puntos: Number(valores.costo_puntos ?? 0),
      activo: valores.activo ?? true,
    };

    this.guardando.set(true);

    try {
      const id = this.editandoId();

      if (id === null) {
        await this.promociones.crearRecompensa(datos);
        this.avisos.exito('Recompensa creada.');
      } else {
        await this.promociones.actualizarRecompensa(id, datos);
        this.avisos.exito('Recompensa actualizada.');
      }

      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.guardando.set(false);
    }
  }
}
