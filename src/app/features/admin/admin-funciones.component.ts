import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FuncionesService } from '../../core/services/funciones.service';
import { PeliculasService } from '../../core/services/peliculas.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { FormatoFuncion, Funcion, IdiomaFuncion, Pelicula } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { SelectorFechaHoraComponent } from '../../shared/components/selector-fecha-hora.component';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

interface GrupoDia {
  clave: string;
  etiqueta: string;
  funciones: Funcion[];
}

interface OpcionDia {
  valor: number;
  etiqueta: string;
}

@Component({
  selector: 'app-admin-funciones',
  imports: [
    ReactiveFormsModule,
    PrecioPipe,
    SelectorFechaHoraComponent,
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

  readonly formulario = this.fb.nonNullable.group({
    peliculaId: ['', [Validators.required]],
    precio: [6500, [Validators.required, Validators.min(1)]],
    precioVip: [0, [Validators.min(0)]],
  });

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
      '. Las entradas vendidas se pierden.'
    );
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
        filtro.desde = new Date(desde + 'T00:00:00').toISOString();
      }

      const hasta = this.filtroHasta();
      if (hasta) {
        filtro.hasta = new Date(hasta + 'T23:59:59').toISOString();
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

  cerrarPanel(): void {
    if (this.guardando()) return;
    this.panelAbierto.set(false);
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

  idiomaLegible(valor: IdiomaFuncion): string {
    return valor === 'castellano' ? 'Castellano' : 'Subtitulada';
  }

  async guardar(): Promise<void> {
    this.errorPanel.set('');
    this.erroresSerie.set([]);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.errorPanel.set('Elegí una película y cargá un precio base mayor a 0.');
      return;
    }

    const valores = this.formulario.getRawValue();
    const peliculaId = Number(valores.peliculaId);
    const precio = Number(valores.precio);
    const precioVip = Number(valores.precioVip);

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

  pedirBaja(funcion: Funcion): void {
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
