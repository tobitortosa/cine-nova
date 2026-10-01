import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PeliculasService } from '../../core/services/peliculas.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Genero, Pelicula } from '../../core/models/modelos';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

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
  ],
  templateUrl: './admin-peliculas.component.html',
  styleUrl: './admin-peliculas.component.scss',
})
export class AdminPeliculasComponent implements OnInit {
  private readonly peliculas = inject(PeliculasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly lista = signal<Pelicula[]>([]);
  readonly generos = signal<Genero[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly busqueda = signal('');

  readonly panelAbierto = signal(false);
  readonly editando = signal<Pelicula | null>(null);
  readonly confirmaAbierta = signal(false);
  readonly paraEliminar = signal<Pelicula | null>(null);

  readonly restriccion = signal(0);
  readonly generosElegidos = signal<number[]>([]);
  readonly vistaPoster = signal('');
  readonly tieneEstreno = signal(false);

  readonly restricciones: number[] = [0, 13, 18];

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

  readonly visibles = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const todas = this.lista();
    if (!texto) return todas;
    return todas.filter((pelicula) => pelicula.titulo.toLowerCase().includes(texto));
  });

  readonly tituloPanel = computed(() => (this.editando() ? 'Editar película' : 'Nueva película'));

  readonly textoConfirmacion = computed(() => {
    const pelicula = this.paraEliminar();
    if (!pelicula) return '';
    return (
      'Se va a eliminar "' +
      pelicula.titulo +
      '" junto con sus funciones y reseñas. Esta acción no se puede deshacer.'
    );
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
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
    this.vistaPoster.set('');
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
    this.vistaPoster.set(pelicula.imagen_url ?? '');
    this.sincronizarPreventa();
    this.panelAbierto.set(true);
  }

  cerrarPanel(): void {
    if (this.guardando()) return;
    this.panelAbierto.set(false);
    this.editando.set(null);
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

  actualizarPoster(valor: string): void {
    this.vistaPoster.set(valor.trim());
  }

  sincronizarPreventa(): void {
    const hayFecha = this.formulario.controls.fecha_estreno.value.trim().length > 0;
    this.tieneEstreno.set(hayFecha);

    if (hayFecha) {
      this.formulario.controls.precio_preventa.enable();
      return;
    }

    this.formulario.controls.precio_preventa.setValue(0);
    this.formulario.controls.precio_preventa.disable();
  }

  async guardar(): Promise<void> {
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
    try {
      const actual = this.editando();
      if (actual) {
        await this.peliculas.actualizar(actual.id, datos, this.generosElegidos());
        this.avisos.exito('Película actualizada');
      } else {
        await this.peliculas.crear(datos, this.generosElegidos());
        this.avisos.exito('Película creada');
      }
      this.panelAbierto.set(false);
      this.editando.set(null);
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo guardar la película');
    } finally {
      this.guardando.set(false);
    }
  }

  pedirBaja(pelicula: Pelicula): void {
    this.paraEliminar.set(pelicula);
    this.confirmaAbierta.set(true);
  }

  async eliminar(): Promise<void> {
    const pelicula = this.paraEliminar();
    if (!pelicula) return;

    try {
      await this.peliculas.eliminar(pelicula.id);
      this.avisos.exito('Se eliminó "' + pelicula.titulo + '"');
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
}
