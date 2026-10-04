import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { FuncionesService } from '../../core/services/funciones.service';
import { PeliculasService } from '../../core/services/peliculas.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { FormatoFuncion, Funcion, IdiomaFuncion, Pelicula } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { SelectorFechaHoraComponent } from '../../shared/components/selector-fecha-hora.component';
import { SelectorFechaComponent } from '../../shared/components/selector-fecha.component';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';
import { entradasVendidas, preventaVigente } from '../../shared/utils/ventas';

interface GrupoDia {
  clave: string;
  etiqueta: string;
  funciones: Funcion[];
}

interface OpcionDia {
  valor: number;
  etiqueta: string;
}

const precioVipValido: ValidatorFn = (grupo: AbstractControl): ValidationErrors | null => {
  const precio = Number(grupo.get('precio')?.value);
  const precioVip = Number(grupo.get('precioVip')?.value);

  if (!Number.isFinite(precio) || precio <= 0) return null;
  if (!Number.isFinite(precioVip) || precioVip === 0) return null;

  return precioVip < precio ? { vipMenorQueEstandar: true } : null;
};

@Component({
  selector: 'app-admin-funciones',
  imports: [
    ReactiveFormsModule,
    PrecioPipe,
    SelectorFechaHoraComponent,
    SelectorFechaComponent,
    CargandoComponent,
    VacioComponent,
    ConfirmarComponent,
  ],
  templateUrl: './admin-funciones.component.html',
  styleUrl: './admin-funciones.component.scss',
})
export class AdminFuncionesComponent implements OnInit {
  private readonly funciones = inject(FuncionesService);
  private readonly peliculasServicio = inject(PeliculasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly lista = signal<Funcion[]>([]);
  readonly peliculas = signal<Pelicula[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);

  readonly filtroPelicula = signal('');
  readonly filtroDesde = signal('');
  readonly filtroHasta = signal('');

  readonly panelAbierto = signal(false);
  readonly modo = signal<'unica' | 'serie'>('unica');
  readonly confirmaAbierta = signal(false);
  readonly paraEliminar = signal<Funcion | null>(null);
  readonly verificandoBaja = signal<number | null>(null);

  readonly editando = signal<Funcion | null>(null);
  readonly vendidasEditando = signal<number | null>(null);
  readonly consultandoVendidas = signal(false);
  private inicioOriginal = '';

  readonly inicio = signal('');
  readonly horaSerie = signal('20:00');
  readonly diasSerie = signal<number[]>([]);
  readonly semanas = signal(4);
  readonly formato = signal<FormatoFuncion>('2D');
  readonly idioma = signal<IdiomaFuncion>('castellano');

  readonly errorPanel = signal('');
  readonly erroresSerie = signal<string[]>([]);

  readonly formatos: FormatoFuncion[] = ['2D', '3D', '4D', '5D'];
  readonly idiomas: IdiomaFuncion[] = ['castellano', 'subtitulada'];
  readonly semanasPosibles: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly horas: number[] = Array.from({ length: 24 }, (_, indice) => indice);
  readonly minutos: number[] = Array.from({ length: 12 }, (_, indice) => indice * 5);

  readonly diasSemana: OpcionDia[] = [
    { valor: 1, etiqueta: 'Lun' },
    { valor: 2, etiqueta: 'Mar' },
    { valor: 3, etiqueta: 'Mié' },
    { valor: 4, etiqueta: 'Jue' },
    { valor: 5, etiqueta: 'Vie' },
    { valor: 6, etiqueta: 'Sáb' },
    { valor: 0, etiqueta: 'Dom' },
  ];

  readonly minimoFecha = this.textoLocal(new Date());

  readonly formulario = this.fb.nonNullable.group(
    {
      peliculaId: ['', [Validators.required]],
      precio: [6500, [Validators.required, Validators.min(1)]],
      precioVip: [0, [Validators.min(0)]],
    },
    { validators: [precioVipValido] },
  );

  readonly grupos = computed<GrupoDia[]>(() => {
    const mapa = new Map<string, Funcion[]>();

    for (const funcion of this.lista()) {
      const clave = this.claveDia(funcion.inicio);
      const actuales = mapa.get(clave);
      if (actuales) {
        actuales.push(funcion);
      } else {
        mapa.set(clave, [funcion]);
      }
    }

    return Array.from(mapa.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([clave, funciones]) => ({
        clave,
        etiqueta: this.etiquetaDia(clave),
        funciones,
      }));
  });

  readonly errorDeSalas = computed(() =>
    this.errorPanel().toLowerCase().includes('no hay salas disponibles'),
  );

  readonly textoConfirmacion = computed(() => {
    const funcion = this.paraEliminar();
    if (!funcion) return '';
    return (
      'Se va a eliminar la función de "' +
      (funcion.pelicula?.titulo ?? 'la película') +
      '" del ' +
      this.fechaCorta(funcion.inicio) +
      ' a las ' +
      this.horaDe(funcion.inicio) +
      '. Si ya tiene entradas vendidas no se va a poder eliminar. Esta acción no se puede deshacer.'
    );
  });

  readonly tituloPanel = computed(() => (this.editando() ? 'Editar función' : 'Nueva función'));

  readonly horarioBloqueado = computed(() => {
    if (!this.editando()) return false;
    const vendidas = this.vendidasEditando();
    return vendidas === null || vendidas > 0;
  });

  readonly motivoHorarioBloqueado = computed(() => {
    if (this.consultandoVendidas()) return 'Revisando si la función tiene entradas vendidas...';
    const vendidas = this.vendidasEditando();
    if (vendidas === null) {
      return 'No pudimos revisar si tiene entradas vendidas, así que por ahora el horario no se puede cambiar.';
    }
    return (
      'Ya tiene ' +
      entradasVendidas(vendidas) +
      ': el horario no se puede cambiar, pero sí el precio, el formato y el idioma.'
    );
  });

  readonly resumenHorarioActual = computed(() => {
    const funcion = this.editando();
    if (!funcion) return '';
    const clave = this.claveDia(funcion.inicio);
    return this.etiquetaDia(clave) + ' · ' + this.horaDe(funcion.inicio) + ' h';
  });

  async ngOnInit(): Promise<void> {
    try {
      this.peliculas.set(await this.peliculasServicio.listar());
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar las películas');
    }
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const filtro: { desde?: string; hasta?: string; peliculaId?: number } = {};

      const pelicula = Number(this.filtroPelicula());
      if (pelicula > 0) {
        filtro.peliculaId = pelicula;
      }

      const desde = this.filtroDesde();
      if (desde) {
        filtro.desde = this.momentoDelDia(desde, 0).toISOString();
      }

      const hasta = this.filtroHasta();
      if (hasta) {
        filtro.hasta = new Date(this.momentoDelDia(hasta, 1).getTime() - 1).toISOString();
      }

      this.lista.set(await this.funciones.listar(filtro));
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar las funciones');
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarPelicula(valor: string): Promise<void> {
    this.filtroPelicula.set(valor);
    await this.cargar();
  }

  async cambiarDesde(valor: string): Promise<void> {
    this.filtroDesde.set(valor);
    await this.cargar();
  }

  async cambiarHasta(valor: string): Promise<void> {
    this.filtroHasta.set(valor);
    await this.cargar();
  }

  async limpiarFiltros(): Promise<void> {
    this.filtroPelicula.set('');
    this.filtroDesde.set('');
    this.filtroHasta.set('');
    await this.cargar();
  }

  abrirPanel(): void {
    this.editando.set(null);
    this.vendidasEditando.set(null);
    this.inicioOriginal = '';
    this.formulario.controls.peliculaId.enable();
    this.modo.set('unica');
    this.formulario.reset({ peliculaId: '', precio: 6500, precioVip: 0 });
    this.inicio.set('');
    this.horaSerie.set('20:00');
    this.diasSerie.set([]);
    this.semanas.set(4);
    this.formato.set('2D');
    this.idioma.set('castellano');
    this.errorPanel.set('');
    this.erroresSerie.set([]);
    this.panelAbierto.set(true);
  }

  async abrirEdicion(funcion: Funcion): Promise<void> {
    if (!this.puedeEditar(funcion)) {
      this.avisos.error('La función ya empezó, así que no se puede editar.');
      return;
    }

    const inicioLocal = this.textoLocal(new Date(funcion.inicio));
    this.editando.set(funcion);
    this.inicioOriginal = inicioLocal;
    this.modo.set('unica');
    this.formulario.reset({
      peliculaId: String(funcion.pelicula_id),
      precio: Number(funcion.precio_base),
      precioVip: Number(funcion.precio_vip),
    });
    this.formulario.controls.peliculaId.disable();
    this.inicio.set(inicioLocal);
    this.formato.set(funcion.formato);
    this.idioma.set(funcion.idioma);
    this.errorPanel.set('');
    this.erroresSerie.set([]);
    this.vendidasEditando.set(null);
    this.consultandoVendidas.set(true);
    this.panelAbierto.set(true);

    const vendidas = await this.funciones.entradasVendidas(funcion.id);
    if (this.editando()?.id !== funcion.id) return;
    this.vendidasEditando.set(vendidas);
    this.consultandoVendidas.set(false);
  }

  puedeEditar(funcion: Funcion): boolean {
    return new Date(funcion.inicio).getTime() > Date.now();
  }

  cerrarPanel(): void {
    if (this.guardando()) return;
    this.panelAbierto.set(false);
    this.editando.set(null);
    this.consultandoVendidas.set(false);
    this.formulario.controls.peliculaId.enable();
  }

  elegirModo(valor: 'unica' | 'serie'): void {
    this.modo.set(valor);
    this.errorPanel.set('');
    this.erroresSerie.set([]);
  }

  elegirFormato(valor: FormatoFuncion): void {
    this.formato.set(valor);
  }

  elegirIdioma(valor: IdiomaFuncion): void {
    this.idioma.set(valor);
  }

  elegirSemanas(valor: number): void {
    this.semanas.set(valor);
  }

  alternarDia(valor: number): void {
    this.diasSerie.update((actuales) =>
      actuales.includes(valor)
        ? actuales.filter((dia) => dia !== valor)
        : [...actuales, valor],
    );
  }

  tieneDia(valor: number): boolean {
    return this.diasSerie().includes(valor);
  }

  horaElegida(): number {
    return Number(this.horaSerie().slice(0, 2));
  }

  minutoElegido(): number {
    return Number(this.horaSerie().slice(3, 5));
  }

  elegirHora(valor: number): void {
    this.horaSerie.set(this.dosDigitos(valor) + ':' + this.dosDigitos(this.minutoElegido()));
  }

  elegirMinuto(valor: number): void {
    this.horaSerie.set(this.dosDigitos(this.horaElegida()) + ':' + this.dosDigitos(valor));
  }

  cambiarInicio(valor: string): void {
    this.inicio.set(valor);
  }

  vipMenorQueEstandar(): boolean {
    const vip = this.formulario.controls.precioVip;
    return this.formulario.hasError('vipMenorQueEstandar') && (vip.dirty || vip.touched);
  }

  idiomaLegible(valor: IdiomaFuncion): string {
    return valor === 'castellano' ? 'Castellano' : 'Subtitulada';
  }

  etiquetaPelicula(pelicula: Pelicula): string {
    if (pelicula.en_cartelera) return pelicula.titulo;
    return pelicula.titulo + (preventaVigente(pelicula) ? ' · preventa' : ' · próximamente');
  }

  async guardar(): Promise<void> {
    this.errorPanel.set('');
    this.erroresSerie.set([]);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      const { peliculaId, precio } = this.formulario.controls;
      this.errorPanel.set(
        peliculaId.invalid || precio.invalid
          ? 'Elegí una película y cargá un precio base mayor a 0.'
          : 'El precio VIP no puede ser menor que el estándar.',
      );
      return;
    }

    const valores = this.formulario.getRawValue();
    const peliculaId = Number(valores.peliculaId);
    const precio = Number(valores.precio);
    const precioVip = Number(valores.precioVip);

    const enEdicion = this.editando();
    if (enEdicion) {
      await this.guardarEdicion(enEdicion, precio, precioVip);
      return;
    }

    if (!peliculaId) {
      this.errorPanel.set('Elegí una película.');
      return;
    }

    if (this.modo() === 'unica') {
      await this.guardarUnica(peliculaId, precio, precioVip);
      return;
    }

    await this.guardarSerie(peliculaId, precio, precioVip);
  }

  private async guardarUnica(
    peliculaId: number,
    precio: number,
    precioVip: number,
  ): Promise<void> {
    const momento = this.inicio();
    if (momento.length < 16) {
      this.errorPanel.set('Elegí el día y el horario de la función.');
      return;
    }

    this.guardando.set(true);
    try {
      await this.funciones.crear(
        peliculaId,
        momento,
        this.formato(),
        this.idioma(),
        precio,
        precioVip,
      );
      this.avisos.exito('Función creada. El sistema le asignó una sala libre.');
      this.panelAbierto.set(false);
      await this.cargar();
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No se pudo crear la función';
      this.errorPanel.set(mensaje);
      this.avisos.error(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }

  private async guardarEdicion(
    funcion: Funcion,
    precio: number,
    precioVip: number,
  ): Promise<void> {
    const momento = this.inicio();
    const cambiaHorario = !this.horarioBloqueado() && momento !== this.inicioOriginal;

    if (cambiaHorario) {
      if (momento.length < 16) {
        this.errorPanel.set('Elegí el día y el horario de la función.');
        return;
      }
      if (new Date(momento).getTime() <= Date.now()) {
        this.errorPanel.set('El nuevo horario tiene que ser posterior a este momento.');
        return;
      }
    }

    this.guardando.set(true);
    try {
      await this.funciones.actualizar(funcion, {
        formato: this.formato(),
        idioma: this.idioma(),
        precio_base: precio,
        precio_vip: precioVip,
        inicio: cambiaHorario ? momento : undefined,
      });
      this.avisos.exito('Función actualizada.');
      this.guardando.set(false);
      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No se pudo actualizar la función';
      this.errorPanel.set(mensaje);
      this.avisos.error(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }

  private async guardarSerie(
    peliculaId: number,
    precio: number,
    precioVip: number,
  ): Promise<void> {
    if (this.diasSerie().length === 0) {
      this.errorPanel.set('Elegí al menos un día de la semana.');
      return;
    }

    this.guardando.set(true);
    try {
      const resultado = await this.funciones.crearSerie(
        peliculaId,
        this.diasSerie(),
        this.horaSerie(),
        this.semanas(),
        this.formato(),
        this.idioma(),
        precio,
        precioVip,
      );

      this.erroresSerie.set(resultado.errores);

      if (resultado.creadas > 0) {
        this.avisos.exito('Se crearon ' + resultado.creadas + ' funciones de la serie.');
      }

      if (resultado.errores.length > 0) {
        const mensaje =
          'Quedaron ' + resultado.errores.length + ' funciones sin crear. Revisá el detalle.';
        this.errorPanel.set(mensaje);
        this.avisos.error(mensaje);
      } else if (resultado.creadas === 0) {
        this.errorPanel.set('No se creó ninguna función. Revisá los días y el horario elegidos.');
      } else {
        this.panelAbierto.set(false);
      }

      await this.cargar();
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No se pudo crear la serie de funciones';
      this.errorPanel.set(mensaje);
      this.avisos.error(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }

  async pedirBaja(funcion: Funcion): Promise<void> {
    if (this.verificandoBaja() !== null) return;

    this.verificandoBaja.set(funcion.id);
    const vendidas = await this.funciones.entradasVendidas(funcion.id);
    this.verificandoBaja.set(null);

    if (vendidas !== null && vendidas > 0) {
      this.avisos.error(
        'La función del ' +
          this.fechaCorta(funcion.inicio) +
          ' ' +
          this.horaDe(funcion.inicio) +
          ' tiene ' +
          entradasVendidas(vendidas) +
          ' y no se puede eliminar.' +
          (this.puedeEditar(funcion)
            ? ' Podés editar su precio, formato o idioma.'
            : ' Como ya empezó, queda en el historial de ventas.'),
      );
      return;
    }

    this.paraEliminar.set(funcion);
    this.confirmaAbierta.set(true);
  }

  async eliminar(): Promise<void> {
    const funcion = this.paraEliminar();
    if (!funcion) return;

    try {
      await this.funciones.eliminar(funcion.id);
      this.avisos.exito('Función eliminada');
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo eliminar la función');
    } finally {
      this.paraEliminar.set(null);
    }
  }

  horaDe(iso: string): string {
    const fecha = new Date(iso);
    return this.dosDigitos(fecha.getHours()) + ':' + this.dosDigitos(fecha.getMinutes());
  }

  fechaCorta(iso: string): string {
    const fecha = new Date(iso);
    return this.dosDigitos(fecha.getDate()) + '/' + this.dosDigitos(fecha.getMonth() + 1);
  }

  private claveDia(iso: string): string {
    const fecha = new Date(iso);
    return (
      fecha.getFullYear() +
      '-' +
      this.dosDigitos(fecha.getMonth() + 1) +
      '-' +
      this.dosDigitos(fecha.getDate())
    );
  }

  private etiquetaDia(clave: string): string {
    const fecha = new Date(
      Number(clave.slice(0, 4)),
      Number(clave.slice(5, 7)) - 1,
      Number(clave.slice(8, 10)),
    );

    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];

    const texto =
      dias[fecha.getDay()] + ' ' + fecha.getDate() + ' de ' + meses[fecha.getMonth()];

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  private momentoDelDia(clave: string, diasDespues: number): Date {
    return new Date(
      Number(clave.slice(0, 4)),
      Number(clave.slice(5, 7)) - 1,
      Number(clave.slice(8, 10)) + diasDespues,
    );
  }

  private textoLocal(fecha: Date): string {
    return (
      fecha.getFullYear() +
      '-' +
      this.dosDigitos(fecha.getMonth() + 1) +
      '-' +
      this.dosDigitos(fecha.getDate()) +
      'T' +
      this.dosDigitos(fecha.getHours()) +
      ':' +
      this.dosDigitos(fecha.getMinutes())
    );
  }

  dosDigitos(valor: number): string {
    return valor < 10 ? '0' + valor : '' + valor;
  }
}
