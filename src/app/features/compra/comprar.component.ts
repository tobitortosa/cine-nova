import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Subscription } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { ButacasService } from '../../core/services/butacas.service';
import { CandyService } from '../../core/services/candy.service';
import { CarritoService, TOPE_UNIDADES } from '../../core/services/carrito.service';
import { ComprasService } from '../../core/services/compras.service';
import { FuncionesService } from '../../core/services/funciones.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import {
  MedioCobrable,
  PasarelaPagoService,
  TarjetaDePrueba,
} from '../../core/services/pasarela-pago.service';
import { PromocionesService } from '../../core/services/promociones.service';
import {
  Butaca,
  Canje,
  Combo,
  Cupon,
  DatosPago,
  Funcion,
  ItemCarrito,
  Producto,
  TipoButaca,
} from '../../core/models/modelos';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { SelectorFechaComponent } from '../../shared/components/selector-fecha.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ButacaPipe } from '../../shared/pipes/butaca.pipe';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import {
  DIAS_PREVENTA,
  MAXIMO_BUTACAS,
  entradasIncluidas,
  finDePreventa,
  funcionIniciada,
  hoyLocal,
  precioEntrada,
  preventaVigente,
  sumarDias,
  tienePreventa,
  ventaAbierta,
} from '../../shared/utils/ventas';
import {
  MarcaTarjeta,
  cvvSegunMarcaValidator,
  detectarMarca,
  formatearNumeroTarjeta,
  formatearVencimiento,
  largoCvv,
  numeroTarjetaValidator,
  soloDigitos,
  titularValidator,
  vencimientoValidator,
} from '../../shared/validators/tarjeta.validators';

type EstadoVisual = 'libre' | 'vendida' | 'reservada';

type CampoTarjeta = 'numero' | 'vencimiento' | 'cvv' | 'titular';

type FasePago = 'pago' | 'registro';

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

interface CanjeVista {
  canje: Canje;
  titulo: string;
  esEntrada: boolean;
  elegido: boolean;
  bloqueado: boolean;
}

interface ProductoCanjeado {
  codigo: string;
  nombre: string;
}

interface OpcionMedio {
  valor: MedioCobrable;
  nombre: string;
  detalle: string;
}

interface VistaTarjeta {
  numero: string;
  vencimiento: string;
  titular: string;
}

interface MontosCompra {
  subtotal: number;
  canjes: number;
  combos: number;
  descuento: number;
  credito: number;
  total: number;
}

interface FotoCompra {
  funcionId: number;
  butacas: number[];
  items: ItemCarrito[];
  email: string;
  cupon: string | null;
  usarCredito: number;
  canjes: string[];
  fechaNacimiento: string | null;
  medio: MedioCobrable;
  numero: string;
  total: number;
}

const DEMORA_RECARGA = 250;
const INTERVALO_SONDEO = 15000;
const TITULAR_DE_EJEMPLO = 'Lucía Fernández';
const LARGO_MAXIMO_CVV = 4;
const EMAIL_COMPLETO = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/;

const VENTA_CERRADA = 'La venta para esta película todavía no abrió';
const DEBITO_SIN_AMEX = 'Para débito aceptamos Visa o Mastercard';
const TOTAL_ACTUALIZADO = 'Actualizamos el total de tu compra, revisalo y confirmá de nuevo.';
const TOTAL_CAMBIADO = 'El total cambió';
const VENTA_NO_ABIERTA = 'todavía no está abierta';
const YA_COMENZO = 'ya comenzó';
const SIN_CONEXION = 'No pudimos comunicarnos';
const FUNCION_COMENZADA = 'La función ya comenzó. Elegí otro horario para comprar tus entradas.';
const BUTACA_PERDIDA =
  'Una de tus butacas dejó de estar disponible mientras confirmabas. Revisá tu selección antes de pagar.';
const PAGO_ANULADO = 'Anulamos el pago simulado: no se te cobró nada.';
const COMPRA_INCIERTA = 'No pudimos confirmar si tu compra se registró';
const BUTACA_NO_DISPONIBLE =
  'Una de tus butacas dejó de estar disponible mientras pagabas. Anulamos el pago simulado: no se te cobró nada.';
const EXCESO_ENTRADAS = 'Tus combos y canjes incluyen más entradas que las butacas elegidas';
const COMBO_SIN_LUGAR =
  'Para sumar este combo elegí más butacas: cada entrada que incluye ocupa una de tus butacas.';
const BIENVENIDA_USADA = 'Ya usaste el cupón de bienvenida';
const SOLO_PRIMERA_COMPRA = 'El cupón de bienvenida es solo para tu primera compra';

function aCentavos(monto: number | null | undefined): number {
  return Math.round(Number(monto ?? 0) * 100);
}

const debitoSinAmexValidator: ValidatorFn = (grupo: AbstractControl): ValidationErrors | null => {
  if (grupo.parent?.get('medio')?.value !== 'tarjeta_debito') return null;
  return detectarMarca(grupo.get('numero')?.value) === 'American Express'
    ? { debitoSinAmex: true }
    : null;
};

const FALTANTES: Record<CampoTarjeta, string> = {
  numero: 'Ingresá el número de la tarjeta',
  vencimiento: 'Ingresá el vencimiento de la tarjeta',
  cvv: 'Ingresá el código de seguridad',
  titular: 'Ingresá el nombre del titular',
};

@Component({
  selector: 'app-comprar',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    CargandoComponent,
    SelectorFechaComponent,
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
  private readonly pasarela = inject(PasarelaPagoService);
  private readonly avisos = inject(NotificacionesService);

  readonly carrito = inject(CarritoService);
  readonly auth = inject(AuthService);

  readonly etapas: Etapa[] = [
    { numero: 1, nombre: 'Butacas' },
    { numero: 2, nombre: 'Candy bar' },
    { numero: 3, nombre: 'Pagar' },
  ];

  readonly mediosPago: OpcionMedio[] = [
    { valor: 'tarjeta_credito', nombre: 'Tarjeta de crédito', detalle: 'Visa, Mastercard o American Express' },
    { valor: 'tarjeta_debito', nombre: 'Tarjeta de débito', detalle: 'Débito Visa o Mastercard' },
    { valor: 'mercado_pago', nombre: 'Mercado Pago', detalle: 'Pagás con tu cuenta, sin datos de tarjeta' },
  ];

  readonly tarjetasDePrueba: TarjetaDePrueba[] = this.pasarela.tarjetasDePrueba;

  readonly topeUnidades = TOPE_UNIDADES;
  readonly hoy = hoyLocal();
  readonly mensajeExceso = EXCESO_ENTRADAS;

  readonly paso = signal(1);
  readonly cargando = signal(true);
  readonly ventaCerrada = signal(false);
  readonly funcionComenzada = signal(false);
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

  readonly canjes = signal<Canje[]>([]);
  private readonly canjesElegidos = signal<string[]>([]);

  readonly medioElegido = signal<MedioCobrable>('tarjeta_credito');
  readonly tarjetaVista = signal<VistaTarjeta>({ numero: '', vencimiento: '', titular: '' });
  readonly pruebasAbiertas = signal(false);
  readonly fasePago = signal<FasePago | null>(null);
  readonly montoEnProceso = signal(0);
  readonly errorPago = signal<string | null>(null);
  readonly emailDeCuenta = signal(false);

  readonly formulario = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.pattern(EMAIL_COMPLETO)]],
    fechaNacimiento: [''],
    cupon: [''],
    usarCredito: [false],
    medio: this.fb.nonNullable.control<MedioCobrable>('tarjeta_credito', Validators.required),
    tarjeta: this.fb.nonNullable.group(
      {
        numero: ['', [Validators.required, numeroTarjetaValidator]],
        vencimiento: ['', [Validators.required, vencimientoValidator]],
        cvv: ['', [Validators.required]],
        titular: ['', [Validators.required, titularValidator]],
      },
      { validators: [cvvSegunMarcaValidator('numero', 'cvv'), debitoSinAmexValidator] },
    ),
  });

  readonly grupoTarjeta = this.formulario.controls.tarjeta;

  private funcionId = 0;
  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private espera: ReturnType<typeof setTimeout> | null = null;
  private sondeo: ReturnType<typeof setInterval> | null = null;
  private readonly vigilantes = new Subscription();
  private destruido = false;
  private vencimientoPendiente = false;
  private venceEn = 0;
  private reservadas: Butaca[] = [];
  private reservaIncierta = false;
  private colaReservas: Promise<unknown> = Promise.resolve();
  private pedidosEstado = 0;
  private estadoAplicado = 0;
  private cargaCatalogo: Promise<boolean> | null = null;

  private readonly alCambiarVisibilidad = (): void => {
    if (this.destruido || document.visibilityState !== 'visible') return;
    if (this.temporizador !== null) this.tic();
    if (this.revisarInicio()) return;
    this.programarRecarga();
  };

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

  readonly enPreventa = computed(() => preventaVigente(this.funcion()?.pelicula));

  readonly finPreventa = computed(() => {
    const fin = finDePreventa(this.funcion()?.pelicula);
    return fin ? this.fechaLarga(fin) : null;
  });

  readonly textoApertura = computed(() => {
    const pelicula = this.funcion()?.pelicula;
    const titulo = pelicula?.titulo ? `«${pelicula.titulo}»` : 'esta película';

    if (!pelicula?.fecha_estreno) {
      return `Todavía no hay una fecha confirmada para la venta de entradas de ${titulo}.`;
    }

    const conPreventa = tienePreventa(pelicula);
    const apertura = this.fechaLarga(
      sumarDias(pelicula.fecha_estreno, conPreventa ? -DIAS_PREVENTA : 0),
    );

    return conPreventa
      ? `Las entradas para ${titulo} se venden desde el ${apertura}, en preventa.`
      : `Las entradas para ${titulo} se venden desde el ${apertura}.`;
  });

  readonly precioEstandar = computed(() => precioEntrada(this.carrito.funcion(), 'estandar'));

  readonly precioVip = computed(() => precioEntrada(this.carrito.funcion(), 'vip'));

  private readonly nombresProductos = computed(
    () => new Map(this.productos().map((producto) => [producto.id, producto.nombre])),
  );

  private readonly entradasPorCombo = computed(
    () => new Map(this.combos().map((combo) => [combo.id, entradasIncluidas(combo)])),
  );

  readonly entradasEnCombos = computed(() =>
    this.carrito.items().reduce((suma, item) => suma + this.entradasDeItem(item), 0),
  );

  readonly cupoCanjesEntrada = computed(() =>
    Math.max(0, this.carrito.butacas().length - this.entradasEnCombos()),
  );

  readonly canjesAplicados = computed<Canje[]>(() => {
    if (!this.auth.estaLogueado()) return [];

    const elegidos = new Set(this.canjesElegidos());
    let cupo = this.cupoCanjesEntrada();

    return this.canjes().filter((canje) => {
      if (!elegidos.has(canje.codigo)) return false;
      if (canje.tipo !== 'entrada') return true;
      if (cupo <= 0) return false;
      cupo -= 1;
      return true;
    });
  });

  readonly entradasCanjeadas = computed(
    () => this.canjesAplicados().filter((canje) => canje.tipo === 'entrada').length,
  );

  readonly productosCanjeados = computed<ProductoCanjeado[]>(() => {
    const nombres = this.nombresProductos();
    return this.canjesAplicados()
      .filter((canje) => canje.tipo === 'producto')
      .map((canje) => ({ codigo: canje.codigo, nombre: this.nombreProducto(canje, nombres) }));
  });

  readonly canjesVista = computed<CanjeVista[]>(() => {
    if (!this.auth.estaLogueado()) return [];

    const aplicados = new Set(this.canjesAplicados().map((canje) => canje.codigo));
    const sinCupo = this.entradasCanjeadas() >= this.cupoCanjesEntrada();
    const nombres = this.nombresProductos();

    return this.canjes().map((canje) => {
      const esEntrada = canje.tipo === 'entrada';
      const elegido = aplicados.has(canje.codigo);
      return {
        canje,
        esEntrada,
        elegido,
        bloqueado: esEntrada && !elegido && sinCupo,
        titulo: esEntrada ? 'Entrada gratis' : this.nombreProducto(canje, nombres),
      };
    });
  });

  readonly hayEntradasBloqueadas = computed(() => this.canjesVista().some((vista) => vista.bloqueado));

  readonly excesoEntradas = computed(
    () => this.entradasEnCombos() + this.entradasCanjeadas() > this.carrito.butacas().length,
  );

  private readonly montos = computed<MontosCompra>(() => {
    const logueado = this.auth.estaLogueado();

    const entradas = this.carrito
      .butacas()
      .reduce((suma, butaca) => suma + aCentavos(this.carrito.precioDe(butaca)), 0);
    const productos = this.carrito
      .items()
      .reduce((suma, item) => suma + item.cantidad * aCentavos(item.precio_unitario), 0);
    const subtotal = entradas + productos;
    const estandar = aCentavos(this.carrito.precioEstandar());

    const canjes = Math.min(this.entradasCanjeadas() * estandar, entradas);
    const combos = Math.min(this.entradasEnCombos() * estandar, entradas - canjes);

    const cupon = this.cuponAplicado();
    const descuento =
      cupon && logueado
        ? Math.round(((subtotal - canjes - combos) * aCentavos(cupon.porcentaje)) / 10000)
        : 0;

    const antesDelCredito = Math.max(0, subtotal - canjes - combos - descuento);
    const credito =
      this.creditoActivo() && logueado
        ? Math.max(0, Math.min(aCentavos(this.creditoDisponible()), antesDelCredito))
        : 0;

    return {
      subtotal,
      canjes,
      combos,
      descuento,
      credito,
      total: Math.max(0, antesDelCredito - credito),
    };
  });

  readonly subtotal = computed(() => this.montos().subtotal / 100);

  readonly descuentoCanjes = computed(() => this.montos().canjes / 100);

  readonly descuentoCombos = computed(() => this.montos().combos / 100);

  readonly subtotalConCombos = computed(() => (this.montos().subtotal - this.montos().combos) / 100);

  readonly descuento = computed(() => this.montos().descuento / 100);

  readonly creditoUsado = computed(() => this.montos().credito / 100);

  readonly total = computed(() => this.montos().total / 100);

  readonly puntosGanados = computed(() =>
    this.auth.estaLogueado() ? Math.floor(this.montos().total / 100) : 0,
  );

  readonly esTarjeta = computed(() => this.medioElegido() !== 'mercado_pago');

  readonly pideTarjeta = computed(() => this.total() > 0 && this.esTarjeta());

  readonly marca = computed<MarcaTarjeta | null>(() => detectarMarca(this.tarjetaVista().numero));

  readonly largoCodigo = computed(() => largoCvv(this.tarjetaVista().numero));

  readonly numeroVista = computed<string[]>(() => {
    const digitos = soloDigitos(this.tarjetaVista().numero);
    const bloques =
      this.marca() === 'American Express'
        ? [4, 6, 5]
        : digitos.length > 16
          ? [4, 4, 4, 4, 3]
          : [4, 4, 4, 4];

    let inicio = 0;

    return bloques.map((cantidad) => {
      let parte = '';
      for (let i = inicio; i < inicio + cantidad; i++) {
        const visible = i < digitos.length && (i < 4 || i >= digitos.length - 4);
        parte += visible ? digitos[i] : '•';
      }
      inicio += cantidad;
      return parte;
    });
  });

  private readonly vigilanteTarjeta = effect(() => {
    const necesaria = this.pideTarjeta();
    untracked(() => this.ajustarGrupoTarjeta(necesaria));
  });

  async ngOnInit(): Promise<void> {
    this.vigilantes.add(
      this.formulario.controls.usarCredito.valueChanges.subscribe((valor) =>
        this.creditoActivo.set(valor === true),
      ),
    );

    this.vigilantes.add(
      this.formulario.controls.medio.valueChanges.subscribe((medio) => {
        this.medioElegido.set(medio);
        this.errorPago.set(null);
        this.grupoTarjeta.updateValueAndValidity({ emitEvent: false });
      }),
    );

    this.vigilantes.add(
      this.grupoTarjeta.valueChanges.subscribe(() => {
        this.formatearTarjeta();
        if (!this.procesando()) this.errorPago.set(null);
      }),
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
      if (this.destruido) return;

      if (!funcion) {
        this.avisos.error('No encontramos esa función');
        return;
      }

      this.funcion.set(funcion);

      if (!ventaAbierta(funcion.pelicula)) {
        this.ventaCerrada.set(true);
        return;
      }

      if (funcionIniciada(funcion.inicio)) {
        this.funcionComenzada.set(true);
        return;
      }

      const anterior = this.carrito.funcion();
      if (anterior && anterior.id !== funcion.id && this.carrito.butacas().length > 0) {
        void this.encolar(() => this.mapaButacas.liberar().catch(() => undefined));
      }

      this.carrito.setFuncion(funcion);

      const butacas = await this.mapaButacas.porSala(funcion.sala_id);
      if (this.destruido) return;
      this.butacasSala.set(butacas);

      await this.cargarEstado();
      if (this.destruido) return;

      if (this.carrito.butacas().length > 0) {
        await this.sincronizarReserva(true);
        if (this.destruido) return;
      }

      const canal = this.mapaButacas.escuchar(id, () => this.programarRecarga());

      if (this.destruido) {
        void this.mapaButacas.dejarDeEscuchar(canal);
        return;
      }

      this.canal = canal;
      this.iniciarSeguimiento();
    } catch (e) {
      if (!this.destruido) {
        this.avisos.error(e instanceof Error ? e.message : 'No pudimos cargar la función');
      }
    } finally {
      if (!this.destruido) {
        this.cargando.set(false);
        this.prepararFormulario();
      }
    }
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.detenerCuenta();
    this.detenerSeguimiento();
    this.vigilantes.unsubscribe();
    this.vigilanteTarjeta.destroy();
    this.grupoTarjeta.reset();

    if (this.canal) {
      void this.mapaButacas.dejarDeEscuchar(this.canal);
      this.canal = null;
    }
  }

  async irAPaso(numero: number): Promise<void> {
    if (numero === this.paso() || this.procesando()) return;

    if (numero > this.paso()) {
      await this.colaReservas;
      if (this.destruido || numero === this.paso() || this.procesando()) return;
    }

    if (this.paso() === 3) {
      this.limpiarPago();
    }

    if (numero > 1 && this.carrito.butacas().length === 0) {
      this.avisos.error('Elegí al menos una butaca para continuar');
      this.paso.set(1);
      return;
    }

    if (numero === 3 && this.excesoEntradas()) {
      this.avisos.error(EXCESO_ENTRADAS);
      if (this.paso() !== 2) {
        void this.sincronizarCatalogo();
        this.paso.set(2);
        this.subirArriba();
      }
      return;
    }

    if (numero === 2) {
      void this.sincronizarCatalogo();
    }

    if (numero === 3) {
      this.errorPago.set(null);
      this.prepararFormulario();
      void this.prepararPago();
      void this.cargarCanjes();
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
    return this.carrito.cantidadDe(productoId, comboId);
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
    if (!this.puedeSumarCombo(combo)) {
      this.avisos.error(COMBO_SIN_LUGAR);
      return;
    }

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

    if (delta > 0) {
      if (actual >= TOPE_UNIDADES) return;

      const combo = comboId !== null ? this.combos().find((opcion) => opcion.id === comboId) : undefined;
      if (combo && !this.puedeSumarCombo(combo)) {
        this.avisos.error(COMBO_SIN_LUGAR);
        return;
      }
    }

    this.carrito.cambiarCantidad(indice, actual + delta);
  }

  entradasDe(combo: Combo): number {
    return entradasIncluidas(combo);
  }

  entradasDeItem(item: ItemCarrito): number {
    if (item.combo_id === null) return 0;
    return item.cantidad * (this.entradasPorCombo().get(item.combo_id) ?? 0);
  }

  puedeSumarCombo(combo: Combo): boolean {
    const incluidas = entradasIncluidas(combo);
    return incluidas === 0 || this.entradasEnCombos() + incluidas <= this.carrito.butacas().length;
  }

  errorEmail(): string | null {
    const control = this.formulario.controls.email;
    if (!control.touched || !control.invalid) return null;
    if (control.hasError('required')) return 'Escribí tu email para enviarte las entradas';
    return 'Revisá el email: tiene que ser como nombre@dominio.com';
  }

  urlActual(): string {
    return this.router.url;
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
      if (this.destruido || this.procesando()) return;

      const encontrado = lista.find(
        (cupon) => cupon.codigo.toUpperCase() === codigo.toUpperCase() && cupon.activo,
      );

      if (!encontrado) {
        throw new Error('El cupón no es válido o ya no está activo');
      }

      if (encontrado.tipo === 'bienvenida') {
        const motivo = await this.motivoSinBienvenida();
        if (this.destruido || this.procesando()) return;
        if (motivo) throw new Error(motivo);
      }

      if (encontrado.tipo === 'edad') {
        const edad = this.edadDelComprador();
        if (edad === null || edad < (encontrado.edad_minima ?? 0)) {
          throw new Error('Este cupón no aplica a tu edad');
        }
      }

      this.cuponAplicado.set(encontrado);
      this.errorPago.set(null);
      this.avisos.exito(`Cupón aplicado: ${encontrado.porcentaje}% de descuento`);
    } catch (e) {
      if (this.destruido || this.procesando()) return;
      this.cuponAplicado.set(null);
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos aplicar el cupón');
    } finally {
      this.aplicandoCupon.set(false);
    }
  }

  quitarCupon(): void {
    this.cuponAplicado.set(null);
    this.errorPago.set(null);
    this.formulario.controls.cupon.setValue('');
  }

  alternarCanje(vista: CanjeVista): void {
    if (this.procesando() || vista.bloqueado) return;

    this.errorPago.set(null);
    const actuales = this.canjesAplicados().map((canje) => canje.codigo);

    this.canjesElegidos.set(
      vista.elegido
        ? actuales.filter((codigo) => codigo !== vista.canje.codigo)
        : [...actuales, vista.canje.codigo],
    );
  }

  alternarPruebas(): void {
    this.pruebasAbiertas.update((abiertas) => !abiertas);
  }

  usarTarjetaDePrueba(prueba: TarjetaDePrueba): void {
    if (this.procesando()) return;

    if (this.formulario.controls.medio.value === 'mercado_pago') {
      this.formulario.controls.medio.setValue('tarjeta_credito');
    }

    this.ajustarGrupoTarjeta();

    const controles = this.grupoTarjeta.controls;
    const cambios: Partial<VistaTarjeta> = { numero: prueba.numero };

    if (!controles.vencimiento.value.trim()) {
      cambios.vencimiento = this.vencimientoDeEjemplo();
    }

    if (!controles.titular.value.trim()) {
      cambios.titular = this.titularDeEjemplo();
    }

    this.grupoTarjeta.patchValue(cambios);
    this.errorPago.set(null);
    this.pruebasAbiertas.set(false);
  }

  errorTarjeta(campo: CampoTarjeta): string | null {
    const control = this.grupoTarjeta.controls[campo];
    if (control.disabled || !control.touched) return null;

    const errores = control.errors;

    if (errores?.['required']) return FALTANTES[campo];

    switch (campo) {
      case 'numero':
        if (errores?.['marcaNoSoportada']) return 'Aceptamos Visa, Mastercard y American Express';
        if (errores?.['largoInvalido']) {
          return `El número no tiene el largo de una tarjeta ${errores['largoInvalido'].marca}`;
        }
        if (errores?.['numeroInvalido']) return 'El número de la tarjeta no es válido. Revisalo';
        if (this.grupoTarjeta.hasError('debitoSinAmex')) return DEBITO_SIN_AMEX;
        return null;
      case 'vencimiento':
        if (errores?.['formatoVencimiento']) return 'Usá el formato MM/AA';
        if (errores?.['tarjetaVencida']) return 'La tarjeta está vencida';
        if (errores?.['vencimientoLejano']) return 'Revisá el año de vencimiento';
        return null;
      case 'cvv': {
        const cvv = this.grupoTarjeta.getError('cvvInvalido');
        if (!cvv) return null;
        const marca = this.marca();
        return marca
          ? `El CVV de ${marca} tiene ${cvv.esperado} dígitos`
          : `El CVV tiene ${cvv.esperado} dígitos`;
      }
      case 'titular':
        return errores?.['titularInvalido']
          ? 'Escribí nombre y apellido, como figuran en la tarjeta'
          : null;
    }
  }

  async confirmar(): Promise<void> {
    const funcion = this.funcion();
    if (!funcion || this.procesando() || this.aplicandoCupon() || this.destruido) return;

    if (this.carrito.butacas().length === 0) {
      this.avisos.error('Elegí al menos una butaca para comprar');
      this.limpiarPago();
      this.paso.set(1);
      return;
    }

    if (this.excesoEntradas()) {
      this.avisos.error(EXCESO_ENTRADAS);
      return;
    }

    this.errorPago.set(null);
    this.ajustarGrupoTarjeta();
    this.formulario.markAllAsTouched();

    if (this.grupoTarjeta.enabled && this.grupoTarjeta.hasError('debitoSinAmex')) {
      this.avisos.error(DEBITO_SIN_AMEX);
      return;
    }

    if (this.formulario.invalid) {
      this.avisos.error('Revisá los datos del formulario antes de confirmar');
      return;
    }

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

    const totalEnPantalla = aCentavos(this.total());
    const butacasAlConfirmar = this.carrito.butacas().map((butaca) => butaca.id);
    let pago: DatosPago | null = null;

    this.procesando.set(true);
    this.formulario.disable({ emitEvent: false });

    try {
      await this.refrescarDatosDePago();
      if (this.destruido) return;

      if (!ventaAbierta(this.funcion()?.pelicula)) {
        this.cerrarVenta();
        return;
      }

      if (funcionIniciada(this.funcion()?.inicio)) {
        this.marcarComenzada();
        this.avisos.error(FUNCION_COMENZADA);
        return;
      }

      const rechazo = await this.sincronizarReserva(true);
      if (this.destruido) return;

      if (rechazo !== null) {
        this.errorPago.set(rechazo);
        return;
      }

      await this.cargarEstado();
      if (this.destruido) return;

      if (!this.mismasButacas(butacasAlConfirmar)) {
        this.errorPago.set(BUTACA_PERDIDA);
        this.avisos.error(BUTACA_PERDIDA);
        return;
      }

      if (this.excesoEntradas()) {
        this.avisos.error(EXCESO_ENTRADAS);
        return;
      }

      if (this.cuponAplicado()?.tipo === 'bienvenida' && this.descuento() > 0) {
        const motivo = await this.motivoSinBienvenida();
        if (this.destruido) return;

        if (motivo) {
          this.quitarCupon();
          this.errorPago.set(motivo);
          this.avisos.error(motivo);
          return;
        }
      }

      if (aCentavos(this.total()) !== totalEnPantalla) {
        this.avisos.info(TOTAL_ACTUALIZADO);
        return;
      }

      const valores = this.formulario.getRawValue();
      const foto: FotoCompra = {
        funcionId: funcion.id,
        butacas: butacasAlConfirmar,
        items: this.carrito.items().map((item) => ({ ...item })),
        email: valores.email.trim(),
        cupon:
          this.auth.estaLogueado() && this.descuento() > 0
            ? (this.cuponAplicado()?.codigo ?? null)
            : null,
        usarCredito: this.creditoUsado(),
        canjes: this.canjesAplicados().map((canje) => canje.codigo),
        fechaNacimiento: valores.fechaNacimiento || null,
        medio: valores.medio,
        numero: valores.tarjeta.numero,
        total: this.total(),
      };

      if (foto.total > 0) {
        this.montoEnProceso.set(foto.total);
        this.fasePago.set('pago');

        const resultado = await this.pasarela.procesar({
          medio: foto.medio,
          monto: foto.total,
          numero: foto.medio === 'mercado_pago' ? undefined : foto.numero,
        });

        if (this.destruido) {
          if (resultado.aprobado) {
            this.avisos.info(PAGO_ANULADO);
          }
          return;
        }

        if (!resultado.aprobado) {
          const motivo = resultado.motivo ?? 'El pago no fue aprobado. Probá con otro medio de pago.';
          this.fasePago.set(null);
          this.errorPago.set(motivo);
          this.avisos.error(motivo);
          return;
        }

        if (!this.mismasButacas(foto.butacas)) {
          this.fasePago.set(null);
          this.errorPago.set(BUTACA_NO_DISPONIBLE);
          this.avisos.error(BUTACA_NO_DISPONIBLE);
          return;
        }

        pago = { medio: foto.medio, marca: resultado.marca, ultimos4: resultado.ultimos4 };
        this.fasePago.set('registro');
      }

      const compra = await this.compras.registrar({
        funcionId: foto.funcionId,
        butacas: foto.butacas,
        items: foto.items,
        email: foto.email,
        cupon: foto.cupon,
        usarCredito: foto.usarCredito,
        fechaNacimiento: foto.fechaNacimiento,
        canjes: foto.canjes,
        pago,
        totalEsperado: foto.total,
      });

      this.vencimientoPendiente = false;
      this.reservadas = [];
      this.grupoTarjeta.reset();
      this.canjesElegidos.set([]);
      this.canjes.set([]);
      this.detenerCuenta();

      if (this.destruido) {
        if (this.carrito.funcion()?.id === foto.funcionId) {
          this.carrito.limpiar();
        }
        if (this.auth.estaLogueado()) {
          void this.auth.refrescarPerfil().catch(() => undefined);
        }
        this.avisos.exito(`Tu compra quedó confirmada con el código ${compra.codigo}`);
        return;
      }

      this.carrito.limpiar();

      if (this.auth.estaLogueado()) {
        await this.auth.refrescarPerfil().catch(() => undefined);
      }

      this.avisos.exito(
        foto.total > 0 ? '¡Pago aprobado! Tu compra quedó confirmada' : '¡Listo! Tu compra quedó confirmada',
      );

      if (this.destruido) return;
      await this.router.navigate(['/compra', compra.codigo]);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No pudimos registrar la compra';
      const incierta = mensaje.includes(COMPRA_INCIERTA);
      this.fasePago.set(null);
      this.errorPago.set(mensaje);
      this.avisos.error(mensaje);

      if (pago && !incierta) {
        this.avisos.info(PAGO_ANULADO);
      }

      if (this.destruido) return;

      if (incierta) {
        this.vencimientoPendiente = false;
        this.reservadas = [];
        this.carrito.limpiarButacas();
        this.detenerCuenta();
        await this.cargarEstado(true);
        return;
      }

      if (mensaje.includes(VENTA_NO_ABIERTA)) {
        this.cerrarVenta();
        return;
      }

      if (mensaje.includes(YA_COMENZO)) {
        this.marcarComenzada();
        return;
      }

      await this.cargarEstado();

      if (!this.destruido && mensaje.includes(TOTAL_CAMBIADO)) {
        await this.recalcularMontos();
      }
    } finally {
      this.fasePago.set(null);
      this.procesando.set(false);

      if (!this.destruido) {
        this.restaurarFormulario();
        if (this.vencimientoPendiente) {
          this.vencerReserva();
        }
      }
    }
  }

  private indiceDe(productoId: number | null, comboId: number | null): number {
    return this.indices().get(this.clave(productoId, comboId)) ?? -1;
  }

  private clave(productoId: number | null, comboId: number | null): string {
    return `${productoId ?? 0}-${comboId ?? 0}`;
  }

  private nombreProducto(canje: Canje, nombres: Map<number, string>): string {
    return (canje.producto_id !== null ? nombres.get(canje.producto_id) : undefined) ?? canje.nombre;
  }

  private mismasButacas(ids: number[]): boolean {
    return this.mismoConjunto(ids, this.carrito.butacas());
  }

  private cerrarVenta(): void {
    this.ventaCerrada.set(true);
    this.detenerCuenta();
    this.detenerSeguimiento();
    this.limpiarPago();
    this.avisos.error(VENTA_CERRADA);
  }

  private marcarComenzada(): void {
    this.funcionComenzada.set(true);
    this.detenerCuenta();
    this.detenerSeguimiento();
    this.limpiarPago();
    this.reservadas = [];
    this.carrito.limpiarButacas();
  }

  private revisarInicio(): boolean {
    if (this.procesando() || !funcionIniciada(this.funcion()?.inicio)) return false;
    this.marcarComenzada();
    return true;
  }

  private async motivoSinBienvenida(): Promise<string | null> {
    if (this.auth.perfil()?.cupon_bienvenida_usado) return BIENVENIDA_USADA;
    return (await this.auth.tieneCompraPagada()) ? SOLO_PRIMERA_COMPRA : null;
  }

  private restaurarFormulario(): void {
    this.formulario.enable({ emitEvent: false });
    this.prepararFormulario();
    this.ajustarGrupoTarjeta();
  }

  private async refrescarDatosDePago(): Promise<void> {
    const tareas: Promise<unknown>[] = [this.sincronizarCatalogo(true), this.recargarFuncion()];

    if (this.auth.estaLogueado()) {
      tareas.push(this.auth.refrescarPerfil());
    }

    await Promise.all(tareas);
  }

  private async prepararPago(): Promise<void> {
    try {
      await this.refrescarDatosDePago();
    } catch {
      return;
    }

    if (this.destruido || this.procesando()) return;
    this.prepararFormulario();
  }

  private async recalcularMontos(): Promise<void> {
    const tareas: Promise<unknown>[] = [this.sincronizarCatalogo(true), this.recargarFuncion()];

    if (this.auth.estaLogueado()) {
      tareas.push(this.auth.refrescarPerfil().catch(() => undefined));
    }

    await Promise.all(tareas);
  }

  private async recargarFuncion(): Promise<void> {
    try {
      const funcion = await this.funciones.obtener(this.funcionId);
      if (!funcion || this.destruido) return;

      this.funcion.set(funcion);
      this.carrito.setFuncion(funcion);
    } catch {
      return;
    }
  }

  private ajustarGrupoTarjeta(necesaria = this.pideTarjeta()): void {
    if (this.procesando()) return;

    const grupo = this.grupoTarjeta;

    if (necesaria && grupo.disabled) {
      grupo.enable({ emitEvent: false });
    }

    if (!necesaria && grupo.enabled) {
      grupo.disable({ emitEvent: false });
    }
  }

  private formatearTarjeta(): void {
    const controles = this.grupoTarjeta.controls;
    const crudo = this.grupoTarjeta.getRawValue();

    const numero = formatearNumeroTarjeta(crudo.numero);
    const vencimiento = formatearVencimiento(crudo.vencimiento);
    const cvv = soloDigitos(crudo.cvv).slice(0, LARGO_MAXIMO_CVV);

    if (numero !== crudo.numero) {
      controles.numero.setValue(numero, { emitEvent: false });
    }

    if (vencimiento !== crudo.vencimiento) {
      controles.vencimiento.setValue(vencimiento, { emitEvent: false });
    }

    if (cvv !== crudo.cvv) {
      controles.cvv.setValue(cvv, { emitEvent: false });
    }

    this.tarjetaVista.set({ numero, vencimiento, titular: crudo.titular });
  }

  private limpiarPago(): void {
    this.grupoTarjeta.reset();
    this.errorPago.set(null);
    this.pruebasAbiertas.set(false);
  }

  private vencimientoDeEjemplo(): string {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const anio = String((hoy.getFullYear() + 3) % 100).padStart(2, '0');
    return `${mes}/${anio}`;
  }

  private titularDeEjemplo(): string {
    const nombre = this.auth.nombreCompleto().trim();
    return nombre.includes(' ') ? nombre : TITULAR_DE_EJEMPLO;
  }

  private fechaLarga(fecha: string): string {
    const momento = new Date(`${fecha.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(momento.getTime())) return fecha;
    return momento.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
  }

  private async cargarCanjes(): Promise<void> {
    if (!this.auth.estaLogueado()) {
      this.canjes.set([]);
      return;
    }

    try {
      const lista = await this.promociones.canjesDisponibles();
      if (this.destruido) return;

      const usables = lista.filter(
        (canje) =>
          !canje.usado &&
          (canje.tipo === 'entrada' || (canje.tipo === 'producto' && canje.producto_id !== null)),
      );

      this.canjes.set(usables);

      if (usables.some((canje) => canje.tipo === 'producto')) {
        void this.cargarCandy();
      }
    } catch (e) {
      if (this.destruido) return;
      this.canjes.set([]);
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos cargar tus canjes');
    }
  }

  private iniciarSeguimiento(): void {
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad);
    this.sondeo = setInterval(() => this.sondear(), INTERVALO_SONDEO);
  }

  private detenerSeguimiento(): void {
    document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);

    if (this.sondeo !== null) {
      clearInterval(this.sondeo);
      this.sondeo = null;
    }

    if (this.espera !== null) {
      clearTimeout(this.espera);
      this.espera = null;
    }
  }

  private sondear(): void {
    if (this.destruido || document.visibilityState === 'hidden') return;
    if (this.revisarInicio()) return;
    if (this.reservaIncierta) void this.sincronizarReserva(true);
    void this.cargarEstado(true);
  }

  private programarRecarga(): void {
    if (this.destruido || this.funcionComenzada() || this.ventaCerrada()) return;

    if (this.espera !== null) {
      clearTimeout(this.espera);
    }

    this.espera = setTimeout(() => {
      this.espera = null;
      void this.cargarEstado(true);
    }, DEMORA_RECARGA);
  }

  private async cargarEstado(silencioso = false): Promise<void> {
    if (!this.funcionId || this.destruido) return;

    const pedido = ++this.pedidosEstado;

    try {
      const filas = await this.mapaButacas.estado(this.funcionId);
      if (this.destruido || pedido <= this.estadoAplicado) return;
      this.estadoAplicado = pedido;

      const mapa = new Map<number, EstadoVisual>();

      for (const fila of filas) {
        if (mapa.get(fila.butaca_id) !== 'vendida') {
          mapa.set(fila.butaca_id, fila.estado);
        }
      }

      this.estados.set(mapa);
      this.depurarSeleccion(mapa);
    } catch (e) {
      if (this.destruido || silencioso || pedido <= this.estadoAplicado) return;
      this.avisos.error(
        e instanceof Error ? e.message : 'No pudimos actualizar el estado de las butacas',
      );
    }
  }

  private descartarEstadosEnCurso(): void {
    this.estadoAplicado = this.pedidosEstado;
  }

  private depurarSeleccion(mapa: Map<number, EstadoVisual>): void {
    if (this.fasePago() === 'registro') return;

    this.reservadas = this.reservadas.filter((butaca) => !mapa.has(butaca.id));

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

  private encolar<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.colaReservas.then(tarea);
    this.colaReservas = resultado.catch(() => undefined);
    return resultado;
  }

  private sincronizarReserva(forzar = false): Promise<string | null> {
    return this.encolar(() => this.reservarSeleccion(forzar));
  }

  private async reservarSeleccion(forzar: boolean): Promise<string | null> {
    if (!this.funcionId || this.destruido || this.funcionComenzada() || this.ventaCerrada()) {
      return null;
    }

    const seleccion = this.carrito.butacas();
    const ids = seleccion.map((butaca) => butaca.id);

    if (!forzar && !this.reservaIncierta && this.mismoConjunto(ids, this.reservadas)) return null;

    const desde = Date.now();

    try {
      const segundos = await this.mapaButacas.reservar(this.funcionId, ids);
      if (this.destruido) return null;

      this.reservaIncierta = false;
      this.reservadas = seleccion;
      this.descartarEstadosEnCurso();
      this.reiniciarCuenta(ids.length > 0, segundos, desde);
      this.programarRecarga();
      return null;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No pudimos reservar esas butacas';
      if (this.destruido) return mensaje;
      if (mensaje.includes(SIN_CONEXION)) this.reservaIncierta = true;

      this.revertirSeleccion(ids);
      this.avisos.error(mensaje);

      if (mensaje.includes(YA_COMENZO)) {
        this.marcarComenzada();
      } else if (mensaje.includes(VENTA_NO_ABIERTA)) {
        this.cerrarVenta();
      } else {
        await this.cargarEstado();
      }

      return mensaje;
    }
  }

  private revertirSeleccion(pedidas: number[]): void {
    const vigentes = this.temporizador !== null ? this.reservadas : [];
    const enPedido = new Set(pedidas);
    const confirmadas = new Set(vigentes.map((butaca) => butaca.id));
    const agregadas = new Set(pedidas.filter((id) => !confirmadas.has(id)));
    const quitadas = vigentes.filter((butaca) => !enPedido.has(butaca.id));

    this.carrito.butacas.update((lista) => {
      const sinAgregadas = lista.filter((butaca) => !agregadas.has(butaca.id));
      const presentes = new Set(sinAgregadas.map((butaca) => butaca.id));
      return [...sinAgregadas, ...quitadas.filter((butaca) => !presentes.has(butaca.id))];
    });

    if (this.carrito.butacas().length === 0) {
      this.detenerCuenta();
    }
  }

  private mismoConjunto(ids: number[], butacas: Butaca[]): boolean {
    const conjunto = new Set(butacas.map((butaca) => butaca.id));
    return conjunto.size === ids.length && ids.every((id) => conjunto.has(id));
  }

  private reiniciarCuenta(activa: boolean, segundos = 0, desde = Date.now()): void {
    this.detenerCuenta();
    this.vencimientoPendiente = false;

    if (!activa) return;

    this.venceEn = desde + segundos * 1000;
    this.temporizador = setInterval(() => this.tic(), 1000);
    this.tic();
  }

  private tic(): void {
    const restante = Math.max(0, Math.ceil((this.venceEn - Date.now()) / 1000));
    this.segundos.set(restante);
    if (restante > 0) return;

    this.detenerCuenta();

    if (this.procesando()) {
      this.vencimientoPendiente = true;
      return;
    }

    this.vencerReserva();
  }

  private vencerReserva(): void {
    this.vencimientoPendiente = false;
    this.carrito.limpiarButacas();
    this.limpiarPago();
    this.paso.set(1);
    this.avisos.info('Se venció el tiempo de reserva. Elegí las butacas otra vez.');
    void this.sincronizarReserva();
    void this.cargarEstado();
  }

  private detenerCuenta(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
    this.segundos.set(0);
  }

  private cargarCandy(forzar = false): Promise<boolean> {
    if (this.cargaCatalogo && !forzar) return this.cargaCatalogo;

    const carga = this.traerCatalogo();
    this.cargaCatalogo = carga;

    void carga.then((listo) => {
      if (!listo && this.cargaCatalogo === carga) {
        this.cargaCatalogo = null;
      }
    });

    return carga;
  }

  private async traerCatalogo(): Promise<boolean> {
    this.cargandoCandy.set(true);

    try {
      const [combos, productos] = await Promise.all([
        this.candy.combos(true),
        this.candy.productos(true),
      ]);

      if (this.destruido) return false;

      this.combos.set(combos);
      this.productos.set(productos);
      return true;
    } catch (e) {
      if (!this.destruido) {
        this.avisos.error(e instanceof Error ? e.message : 'No pudimos cargar el candy bar');
      }
      return false;
    } finally {
      this.cargandoCandy.set(false);
    }
  }

  private async sincronizarCatalogo(forzar = false): Promise<void> {
    const listo = await this.cargarCandy(forzar);
    if (!listo || this.destruido) return;

    const quitados = this.carrito.sincronizarConCatalogo(this.productos(), this.combos());
    if (quitados.length === 0) return;

    this.avisos.info(
      quitados.length === 1
        ? `Sacamos ${quitados[0]} de tu pedido porque ya no está disponible.`
        : `Sacamos ${quitados.join(', ')} de tu pedido porque ya no están disponibles.`,
    );
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

    this.emailDeCuenta.set(!!perfil?.email);

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
    const [anioHoy, mesHoy, diaHoy] = hoyLocal().split('-').map(Number);

    let anios = anioHoy - anio;
    if (mesHoy < mes || (mesHoy === mes && diaHoy < dia)) anios--;

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
