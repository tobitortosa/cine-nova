import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Subscription } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { ButacasService } from '../../core/services/butacas.service';
import { CandyService } from '../../core/services/candy.service';
import { CarritoService } from '../../core/services/carrito.service';
import { ComprasService } from '../../core/services/compras.service';
import { FuncionesService } from '../../core/services/funciones.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PromocionesService } from '../../core/services/promociones.service';
import { Butaca, Combo, Cupon, Funcion, Producto, TipoButaca } from '../../core/models/modelos';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ButacaPipe } from '../../shared/pipes/butaca.pipe';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';

type EstadoVisual = 'libre' | 'vendida' | 'reservada';

interface ButacaVista {
  butaca: Butaca;
  etiqueta: string;
  estado: EstadoVisual;
  seleccionada: boolean;
}

interface FilaVista {
  letra: string;
  bloques: ButacaVista[][];
}

interface GrupoProductos {
  nombre: string;
  productos: Producto[];
}

interface Etapa {
  numero: number;
  nombre: string;
}

const MAXIMO_BUTACAS = 10;
const SEGUNDOS_RESERVA = 480;

@Component({
  selector: 'app-comprar',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    CargandoComponent,
    VacioComponent,
    ButacaPipe,
    DuracionPipe,
    PrecioPipe,
    RestriccionPipe,
  ],
  templateUrl: './comprar.component.html',
  styleUrl: './comprar.component.scss',
})
export class ComprarComponent implements OnInit, OnDestroy {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly funciones = inject(FuncionesService);
  private readonly mapaButacas = inject(ButacasService);
  private readonly candy = inject(CandyService);
  private readonly compras = inject(ComprasService);
  private readonly promociones = inject(PromocionesService);
  private readonly avisos = inject(NotificacionesService);

  readonly carrito = inject(CarritoService);
  readonly auth = inject(AuthService);

  readonly etapas: Etapa[] = [
    { numero: 1, nombre: 'Butacas' },
    { numero: 2, nombre: 'Candy bar' },
    { numero: 3, nombre: 'Pagar' },
  ];

  readonly paso = signal(1);
  readonly cargando = signal(true);
  readonly funcion = signal<Funcion | null>(null);
  readonly butacasSala = signal<Butaca[]>([]);
  readonly estados = signal<Map<number, EstadoVisual>>(new Map());
  readonly segundos = signal(0);

  readonly cargandoCandy = signal(false);
  readonly combos = signal<Combo[]>([]);
  readonly productos = signal<Producto[]>([]);

  readonly procesando = signal(false);
  readonly aplicandoCupon = signal(false);
  readonly cuponAplicado = signal<Cupon | null>(null);
  readonly creditoActivo = signal(false);

  readonly formulario = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    fechaNacimiento: [''],
    cupon: [''],
    usarCredito: [false],
  });

  private funcionId = 0;
  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private vigilanteCredito: Subscription | null = null;

  readonly filas = computed<FilaVista[]>(() => {
    const mapa = this.estados();
    const elegidas = new Set(this.carrito.butacas().map((b) => b.id));
    const porFila = new Map<string, Butaca[]>();

    for (const butaca of this.butacasSala()) {
      const actuales = porFila.get(butaca.fila) ?? [];
      actuales.push(butaca);
      porFila.set(butaca.fila, actuales);
    }

    return [...porFila.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([letra, lista]) => ({
        letra,
        bloques: [1, 2, 3].map((columna) =>
          lista
            .filter((butaca) => butaca.columna === columna)
            .sort((a, b) => a.numero - b.numero)
            .map((butaca) => ({
              butaca,
              etiqueta: `${butaca.fila}${butaca.numero}`,
              estado: mapa.get(butaca.id) ?? 'libre',
              seleccionada: elegidas.has(butaca.id),
            })),
        ),
      }));
  });

  readonly elegidas = computed(() =>
    [...this.carrito.butacas()].sort(
      (a, b) => a.fila.localeCompare(b.fila) || a.numero - b.numero,
    ),
  );

  readonly reloj = computed(() => {
    const total = this.segundos();
    const minutos = Math.floor(total / 60);
    const resto = total % 60;
    return `${minutos}:${String(resto).padStart(2, '0')}`;
  });

  readonly grupos = computed<GrupoProductos[]>(() => {
    const mapa = new Map<string, Producto[]>();

    for (const producto of this.productos()) {
      const nombre = producto.categoria?.nombre ?? 'Otros';
      const actuales = mapa.get(nombre) ?? [];
      actuales.push(producto);
      mapa.set(nombre, actuales);
    }

    return [...mapa.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es'))
      .map(([nombre, productos]) => ({ nombre, productos }));
  });

  private readonly indices = computed(() => {
    const mapa = new Map<string, number>();
    this.carrito.items().forEach((item, indice) => {
      mapa.set(this.clave(item.producto_id, item.combo_id), indice);
    });
    return mapa;
  });

  readonly restriccion = computed(() => this.funcion()?.pelicula?.restriccion_edad ?? 0);

  readonly necesitaNacimiento = computed(
    () => this.restriccion() > 0 && !this.auth.perfil()?.fecha_nacimiento,
  );

  readonly creditoDisponible = computed(() => this.auth.perfil()?.credito ?? 0);

  readonly descuento = computed(() => {
    const cupon = this.cuponAplicado();
    if (!cupon) return 0;
    return Math.round(this.carrito.subtotal() * cupon.porcentaje) / 100;
  });

  readonly creditoUsado = computed(() => {
    if (!this.creditoActivo() || !this.auth.estaLogueado()) return 0;
    const restante = this.carrito.subtotal() - this.descuento();
    return Math.max(0, Math.min(this.creditoDisponible(), restante));
  });

  readonly total = computed(() =>
    Math.max(0, this.carrito.subtotal() - this.descuento() - this.creditoUsado()),
  );

  readonly puntosGanados = computed(() =>
    this.auth.estaLogueado() ? Math.floor(this.total()) : 0,
  );

  async ngOnInit(): Promise<void> {
    this.vigilanteCredito = this.formulario.controls.usarCredito.valueChanges.subscribe((valor) =>
      this.creditoActivo.set(valor === true),
    );

    const crudo = this.ruta.snapshot.paramMap.get('funcionId');
    const id = Number(crudo);

    if (!Number.isFinite(id) || id <= 0) {
      this.cargando.set(false);
      this.avisos.error('La función indicada no es válida');
      return;
    }

    this.funcionId = id;

    try {
      const funcion = await this.funciones.obtener(id);

      if (!funcion) {
        this.avisos.error('No encontramos esa función');
        return;
      }

      this.funcion.set(funcion);
      this.carrito.setFuncion(funcion);
      this.butacasSala.set(await this.mapaButacas.porSala(funcion.sala_id));
      await this.cargarEstado();

      if (this.carrito.butacas().length > 0) {
        await this.sincronizarReserva();
      }

      this.canal = this.mapaButacas.escuchar(id, () => {
        void this.cargarEstado();
      });
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos cargar la función');
    } finally {
      this.cargando.set(false);
      this.prepararFormulario();
    }
  }

  ngOnDestroy(): void {
    this.detenerCuenta();
    this.vigilanteCredito?.unsubscribe();

    if (this.canal) {
      void this.mapaButacas.dejarDeEscuchar(this.canal);
      this.canal = null;
    }
  }

  irAPaso(numero: number): void {
    if (numero === this.paso()) return;

    if (numero > 1 && this.carrito.butacas().length === 0) {
      this.avisos.error('Elegí al menos una butaca para continuar');
      this.paso.set(1);
      return;
    }

    if (numero === 2) {
      void this.cargarCandy();
    }

    if (numero === 3) {
      this.prepararFormulario();
    }

    this.paso.set(numero);
    this.subirArriba();
  }

  async alternar(vista: ButacaVista): Promise<void> {
    if (vista.estado !== 'libre') return;

    if (!vista.seleccionada && this.carrito.butacas().length >= MAXIMO_BUTACAS) {
      this.avisos.error(`Podés elegir hasta ${MAXIMO_BUTACAS} butacas por compra`);
      return;
    }

    this.carrito.alternarButaca(vista.butaca);
    await this.sincronizarReserva();
  }

  async quitar(butaca: Butaca): Promise<void> {
    this.carrito.alternarButaca(butaca);
    await this.sincronizarReserva();
  }

  etiquetaTipo(tipo: TipoButaca): string {
    if (tipo === 'vip') return 'VIP';
    if (tipo === 'accesible') return 'Accesible';
    return 'Estándar';
  }

  etiquetaIdioma(funcion: Funcion): string {
    return funcion.idioma === 'castellano' ? 'Castellano' : 'Subtitulada';
  }

  descripcionButaca(vista: ButacaVista): string {
    if (vista.estado === 'vendida') return `${vista.etiqueta} · ya vendida`;
    if (vista.estado === 'reservada') return `${vista.etiqueta} · reservada por otra persona`;
    return `${vista.etiqueta} · ${this.etiquetaTipo(vista.butaca.tipo)}`;
  }

  fechaHora(iso: string): string {
    const momento = new Date(iso);
    if (Number.isNaN(momento.getTime())) return '';

    const fecha = momento.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const hora = momento.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    return `${fecha.charAt(0).toUpperCase()}${fecha.slice(1)} · ${hora}`;
  }

  cantidadDe(productoId: number | null, comboId: number | null): number {
    const indice = this.indiceDe(productoId, comboId);
    if (indice < 0) return 0;
    return this.carrito.items()[indice]?.cantidad ?? 0;
  }

  agregarProducto(producto: Producto): void {
    this.carrito.agregarProducto({
      producto_id: producto.id,
      combo_id: null,
      nombre: producto.nombre,
      cantidad: 1,
      precio_unitario: producto.precio,
      imagen_url: producto.imagen_url,
    });
  }

  agregarCombo(combo: Combo): void {
    this.carrito.agregarProducto({
      producto_id: null,
      combo_id: combo.id,
      nombre: combo.nombre,
      cantidad: 1,
      precio_unitario: combo.precio,
      imagen_url: combo.imagen_url,
    });
  }

  cambiarCantidad(productoId: number | null, comboId: number | null, delta: number): void {
    const indice = this.indiceDe(productoId, comboId);
    if (indice < 0) return;

    const actual = this.carrito.items()[indice]?.cantidad ?? 0;
    this.carrito.cambiarCantidad(indice, actual + delta);
  }

  async aplicarCupon(): Promise<void> {
    const codigo = this.formulario.controls.cupon.value.trim();

    if (!codigo) {
      this.avisos.error('Escribí un código de cupón');
      return;
    }

    this.aplicandoCupon.set(true);

    try {
      const lista = await this.promociones.cupones();
      const encontrado = lista.find(
        (cupon) => cupon.codigo.toUpperCase() === codigo.toUpperCase() && cupon.activo,
      );

      if (!encontrado) {
        throw new Error('El cupón no es válido o ya no está activo');
      }

      if (encontrado.tipo === 'bienvenida' && this.auth.perfil()?.cupon_bienvenida_usado) {
        throw new Error('Ya usaste el cupón de bienvenida');
      }

      if (encontrado.tipo === 'edad') {
        const edad = this.edadDelComprador();
        if (edad === null || edad < (encontrado.edad_minima ?? 0)) {
          throw new Error('Este cupón no aplica a tu edad');
        }
      }

      this.cuponAplicado.set(encontrado);
      this.avisos.exito(`Cupón aplicado: ${encontrado.porcentaje}% de descuento`);
    } catch (e) {
      this.cuponAplicado.set(null);
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos aplicar el cupón');
    } finally {
      this.aplicandoCupon.set(false);
    }
  }

  quitarCupon(): void {
    this.cuponAplicado.set(null);
    this.formulario.controls.cupon.setValue('');
  }

  async confirmar(): Promise<void> {
    const funcion = this.funcion();
    if (!funcion || this.procesando()) return;

    if (this.carrito.butacas().length === 0) {
      this.avisos.error('Elegí al menos una butaca para comprar');
      this.paso.set(1);
      return;
    }

    this.formulario.markAllAsTouched();

    if (this.formulario.invalid) {
      this.avisos.error('Revisá los datos del formulario antes de confirmar');
      return;
    }

    const valores = this.formulario.getRawValue();
    const minima = this.restriccion();

    if (minima > 0) {
      const edad = this.edadDelComprador();

      if (edad === null) {
        this.avisos.error('Necesitamos tu fecha de nacimiento para esta película');
        return;
      }

      if (edad < minima) {
        this.avisos.error(`Esta película es solo para mayores de ${minima} años`);
        return;
      }
    }

    this.procesando.set(true);

    try {
      const compra = await this.compras.registrar({
        funcionId: funcion.id,
        butacas: this.carrito.butacas().map((butaca) => butaca.id),
        items: this.carrito.items(),
        email: valores.email.trim(),
        cupon: this.auth.estaLogueado() ? (this.cuponAplicado()?.codigo ?? null) : null,
        usarCredito: this.creditoUsado(),
        fechaNacimiento: valores.fechaNacimiento || null,
      });

      this.detenerCuenta();
      this.carrito.limpiar();
      this.avisos.exito('¡Listo! Tu compra quedó confirmada');
      await this.router.navigate(['/compra', compra.codigo]);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos registrar la compra');
      await this.cargarEstado();
    } finally {
      this.procesando.set(false);
    }
  }

  private indiceDe(productoId: number | null, comboId: number | null): number {
    return this.indices().get(this.clave(productoId, comboId)) ?? -1;
  }

  private clave(productoId: number | null, comboId: number | null): string {
    return `${productoId ?? 0}-${comboId ?? 0}`;
  }

  private async cargarEstado(): Promise<void> {
    if (!this.funcionId) return;

    try {
      const filas = await this.mapaButacas.estado(this.funcionId);
      const mapa = new Map<number, EstadoVisual>();

      for (const fila of filas) {
        mapa.set(fila.butaca_id, fila.estado);
      }

      this.estados.set(mapa);
      this.depurarSeleccion(mapa);
    } catch (e) {
      this.avisos.error(
        e instanceof Error ? e.message : 'No pudimos actualizar el estado de las butacas',
      );
    }
  }

  private depurarSeleccion(mapa: Map<number, EstadoVisual>): void {
    const perdidas = this.carrito.butacas().filter((butaca) => mapa.has(butaca.id));
    if (perdidas.length === 0) return;

    const etiquetas = perdidas.map((butaca) => `${butaca.fila}${butaca.numero}`).join(', ');
    this.carrito.butacas.update((lista) => lista.filter((butaca) => !mapa.has(butaca.id)));

    if (this.carrito.butacas().length === 0) {
      this.detenerCuenta();
    }

    this.avisos.error(
      perdidas.length === 1
        ? `Otra persona se quedó con la butaca ${etiquetas}. La sacamos de tu selección.`
        : `Otra persona se quedó con las butacas ${etiquetas}. Las sacamos de tu selección.`,
    );
  }

  private async sincronizarReserva(): Promise<void> {
    if (!this.funcionId) return;

    const ids = this.carrito.butacas().map((butaca) => butaca.id);

    try {
      await this.mapaButacas.reservar(this.funcionId, ids);
      this.reiniciarCuenta(ids.length > 0);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos reservar esas butacas');
      await this.cargarEstado();
    }
  }

  private reiniciarCuenta(activa: boolean): void {
    this.detenerCuenta();

    if (!activa) {
      this.segundos.set(0);
      return;
    }

    this.segundos.set(SEGUNDOS_RESERVA);

    this.temporizador = setInterval(() => {
      const restante = this.segundos() - 1;
      this.segundos.set(Math.max(0, restante));

      if (restante <= 0) {
        this.detenerCuenta();
        this.carrito.limpiarButacas();
        this.paso.set(1);
        this.avisos.info('Se venció el tiempo de reserva. Elegí las butacas otra vez.');
        void this.cargarEstado();
      }
    }, 1000);
  }

  private detenerCuenta(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
    this.segundos.set(0);
  }

  private async cargarCandy(): Promise<void> {
    if (this.combos().length > 0 || this.productos().length > 0) return;

    this.cargandoCandy.set(true);

    try {
      const [combos, productos] = await Promise.all([
        this.candy.combos(true),
        this.candy.productos(true),
      ]);

      this.combos.set(combos);
      this.productos.set(productos);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos cargar el candy bar');
    } finally {
      this.cargandoCandy.set(false);
    }
  }

  private prepararFormulario(): void {
    const perfil = this.auth.perfil();
    const email = this.formulario.controls.email;

    if (perfil?.email) {
      email.setValue(perfil.email);
      email.disable({ emitEvent: false });
    } else {
      email.enable({ emitEvent: false });
    }

    const nacimiento = this.formulario.controls.fechaNacimiento;

    if (this.necesitaNacimiento()) {
      nacimiento.setValidators([Validators.required]);
    } else {
      nacimiento.clearValidators();
    }

    nacimiento.updateValueAndValidity({ emitEvent: false });
  }

  private edadDelComprador(): number | null {
    return this.auth.edad() ?? this.edadDesde(this.formulario.controls.fechaNacimiento.value);
  }

  private edadDesde(valor: string): number | null {
    if (!valor) return null;

    const partes = valor.slice(0, 10).split('-').map(Number);
    if (partes.length !== 3 || partes.some((numero) => !Number.isFinite(numero))) return null;

    const [anio, mes, dia] = partes;
    const hoy = new Date();

    let anios = hoy.getFullYear() - anio;
    const mesActual = hoy.getMonth() + 1;
    if (mesActual < mes || (mesActual === mes && hoy.getDate() < dia)) anios--;

    return anios >= 0 ? anios : null;
  }

  private subirArriba(): void {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      return;
    }
  }
}
