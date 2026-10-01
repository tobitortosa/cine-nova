import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FuncionesService } from '../../core/services/funciones.service';
import { ButacasService } from '../../core/services/butacas.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Sala, TipoButaca } from '../../core/models/modelos';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

interface SalaDetalle {
  sala: Sala;
  total: number;
  estandar: number;
  vip: number;
  accesible: number;
}

@Component({
  selector: 'app-admin-salas',
  imports: [ReactiveFormsModule, CargandoComponent, VacioComponent, ConfirmarComponent],
  templateUrl: './admin-salas.component.html',
  styleUrl: './admin-salas.component.scss',
})
export class AdminSalasComponent implements OnInit {
  private readonly funciones = inject(FuncionesService);
  private readonly butacas = inject(ButacasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly lista = signal<SalaDetalle[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);

  readonly panelAbierto = signal(false);
  readonly confirmaAbierta = signal(false);
  readonly paraEliminar = signal<Sala | null>(null);

  readonly filas: string[] = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  ];
  readonly bloqueLateral: number[] = [1, 2, 3, 4];
  readonly bloqueCentral: number[] = Array.from({ length: 20 }, (_, indice) => indice + 1);

  private readonly filasAccesibles: string[] = ['J', 'K'];
  private readonly filasVip: string[] = ['R', 'S', 'T'];

  readonly formulario = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
  });

  readonly totalButacas = computed(() =>
    this.lista().reduce((suma, detalle) => suma + detalle.total, 0),
  );

  readonly textoConfirmacion = computed(() => {
    const sala = this.paraEliminar();
    if (!sala) return '';
    return (
      'Se va a eliminar la sala "' +
      sala.nombre +
      '" con todas sus butacas y funciones programadas. Esta acción no se puede deshacer.'
    );
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const salas = await this.funciones.salas();

      const detalles = await Promise.all(
        salas.map(async (sala) => {
          const butacas = await this.butacas.porSala(sala.id);
          return {
            sala,
            total: butacas.length,
            estandar: this.contar(butacas, 'estandar'),
            vip: this.contar(butacas, 'vip'),
            accesible: this.contar(butacas, 'accesible'),
          };
        }),
      );

      this.lista.set(detalles);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudieron cargar las salas');
    } finally {
      this.cargando.set(false);
    }
  }

  abrirPanel(): void {
    this.formulario.reset({ nombre: '' });
    this.panelAbierto.set(true);
  }

  cerrarPanel(): void {
    if (this.guardando()) return;
    this.panelAbierto.set(false);
  }

  async guardar(): Promise<void> {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.avisos.error('Escribí un nombre para la sala');
      return;
    }

    this.guardando.set(true);
    try {
      const sala = await this.funciones.crearSala(this.formulario.getRawValue().nombre.trim());
      this.avisos.exito('Se creó la sala "' + sala.nombre + '" con sus butacas');
      this.panelAbierto.set(false);
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo crear la sala');
    } finally {
      this.guardando.set(false);
    }
  }

  pedirBaja(sala: Sala): void {
    this.paraEliminar.set(sala);
    this.confirmaAbierta.set(true);
  }

  async eliminar(): Promise<void> {
    const sala = this.paraEliminar();
    if (!sala) return;

    try {
      await this.funciones.eliminarSala(sala.id);
      this.avisos.exito('Se eliminó la sala "' + sala.nombre + '"');
      await this.cargar();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo eliminar la sala');
    } finally {
      this.paraEliminar.set(null);
    }
  }

  tipoDeFila(letra: string): TipoButaca {
    if (this.filasAccesibles.includes(letra)) return 'accesible';
    if (this.filasVip.includes(letra)) return 'vip';
    return 'estandar';
  }

  esAccesible(letra: string): boolean {
    return this.tipoDeFila(letra) === 'accesible';
  }

  esVip(letra: string): boolean {
    return this.tipoDeFila(letra) === 'vip';
  }

  porcentaje(parte: number, total: number): number {
    return total > 0 ? Math.round((parte / total) * 100) : 0;
  }

  private contar(butacas: { tipo: TipoButaca }[], tipo: TipoButaca): number {
    return butacas.filter((butaca) => butaca.tipo === tipo).length;
  }
}
