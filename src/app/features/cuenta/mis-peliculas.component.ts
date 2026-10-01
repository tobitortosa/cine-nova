import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ComprasService } from '../../core/services/compras.service';
import { ReseniasService } from '../../core/services/resenias.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { MiPelicula } from '../../core/models/modelos';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { EstrellasComponent } from '../../shared/components/estrellas.component';

@Component({
  selector: 'app-mis-peliculas',
  imports: [
    RouterLink,
    RouterLinkActive,
    ReactiveFormsModule,
    CargandoComponent,
    VacioComponent,
    EstrellasComponent,
  ],
  templateUrl: './mis-peliculas.component.html',
  styleUrl: './mis-peliculas.component.scss',
})
export class MisPeliculasComponent implements OnInit {
  private readonly compras = inject(ComprasService);
  private readonly resenias = inject(ReseniasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly exacto = { exact: true };

  readonly lista = signal<MiPelicula[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  readonly editando = signal<MiPelicula | null>(null);
  readonly puntaje = signal(0);
  readonly guardando = signal(false);
  readonly buscandoResenia = signal(false);

  readonly formulario = this.fb.nonNullable.group({
    comentario: [''],
  });

  readonly calificadas = computed(
    () => this.lista().filter((pelicula) => pelicula.estrellas !== null).length,
  );

  private readonly formatoFecha = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');

    try {
      this.lista.set(await this.compras.misPeliculas());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No pudimos cargar tus películas');
    } finally {
      this.cargando.set(false);
    }
  }

  clave(pelicula: MiPelicula): string {
    return `${pelicula.pelicula_id}-${pelicula.vista_en}`;
  }

  fechaDe(pelicula: MiPelicula): string {
    const momento = new Date(pelicula.vista_en);
    if (Number.isNaN(momento.getTime())) return '';

    return this.formatoFecha.format(momento);
  }

  async abrir(pelicula: MiPelicula): Promise<void> {
    this.editando.set(pelicula);
    this.puntaje.set(pelicula.estrellas ?? 0);
    this.formulario.setValue({ comentario: '' });
    this.buscandoResenia.set(true);

    try {
      const resenia = await this.resenias.miResenia(pelicula.pelicula_id);

      if (resenia && this.editando()?.pelicula_id === pelicula.pelicula_id) {
        this.puntaje.set(resenia.estrellas);
        this.formulario.setValue({ comentario: resenia.comentario ?? '' });
      }
    } catch {
      this.avisos.info('No pudimos recuperar tu reseña anterior, podés escribirla de nuevo');
    } finally {
      this.buscandoResenia.set(false);
    }
  }

  cerrar(): void {
    if (this.guardando()) return;

    this.editando.set(null);
    this.puntaje.set(0);
    this.formulario.setValue({ comentario: '' });
  }

  async guardarResenia(): Promise<void> {
    const pelicula = this.editando();
    if (!pelicula || this.guardando()) return;

    if (this.puntaje() < 1) {
      this.avisos.error('Elegí al menos una estrella para calificar');
      return;
    }

    this.guardando.set(true);
    const estrellas = this.puntaje();

    try {
      await this.resenias.guardar(
        pelicula.pelicula_id,
        estrellas,
        this.formulario.getRawValue().comentario,
      );

      this.lista.update((actuales) =>
        actuales.map((item) =>
          item.pelicula_id === pelicula.pelicula_id ? { ...item, estrellas } : item,
        ),
      );

      this.avisos.exito('¡Gracias por calificar!');
      this.guardando.set(false);
      this.cerrar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos guardar tu reseña');
      this.guardando.set(false);
    }
  }
}
