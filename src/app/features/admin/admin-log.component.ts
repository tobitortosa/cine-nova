import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LogActividad } from '../../core/models/modelos';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ReportesService } from '../../core/services/reportes.service';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import {
  ColorAccion,
  colorAccion,
  etiquetaAccion,
  nombreEntidad,
  resumenActividad,
} from './actividad';

const POR_PAGINA = 50;

interface RegistroVista {
  id: number;
  fecha: string;
  hora: string;
  email: string;
  accion: string;
  etiqueta: string;
  entidad: string;
  entidadId: string;
  detalle: string;
  color: ColorAccion;
}

@Component({
  selector: 'app-admin-log',
  imports: [ReactiveFormsModule, CargandoComponent, VacioComponent],
  templateUrl: './admin-log.component.html',
  styleUrl: './admin-log.component.scss',
})
export class AdminLogComponent implements OnInit {
  private readonly reportes = inject(ReportesService);
  private readonly avisos = inject(NotificacionesService);

  readonly busqueda = new FormControl('', { nonNullable: true });

  readonly registros = signal<LogActividad[]>([]);
  readonly texto = signal('');
  readonly cargando = signal(true);
  readonly cargandoMas = signal(false);
  readonly hayMas = signal(false);

  private readonly todas = computed<RegistroVista[]>(() =>
    this.registros().map((fila) => ({
      id: fila.id,
      fecha: this.fecha(fila.creado_en),
      hora: this.hora(fila.creado_en),
      email: fila.email ?? 'Sistema',
      accion: fila.accion,
      etiqueta: etiquetaAccion(fila.accion),
      entidad: nombreEntidad(fila.entidad),
      entidadId: fila.entidad_id ?? '',
      detalle: resumenActividad(fila),
      color: colorAccion(fila.accion),
    })),
  );

  readonly vistas = computed<RegistroVista[]>(() => {
    const filtro = this.texto().trim().toLowerCase();
    if (!filtro) return this.todas();

    return this.todas().filter((registro) =>
      `${registro.accion} ${registro.etiqueta} ${registro.entidad} ${registro.email} ${registro.detalle}`
        .toLowerCase()
        .includes(filtro),
    );
  });

  readonly total = computed(() => this.registros().length);
  readonly filtrando = computed(() => this.texto().trim().length > 0);

  constructor() {
    this.busqueda.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((valor) => this.texto.set(valor));
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async recargar(): Promise<void> {
    await this.cargar();
  }

  limpiar(): void {
    this.busqueda.setValue('');
  }

  async cargarMas(): Promise<void> {
    if (this.cargandoMas() || !this.hayMas()) return;

    this.cargandoMas.set(true);

    try {
      const pagina = await this.reportes.actividad(POR_PAGINA, this.registros().length);
      const conocidos = new Set(this.registros().map((fila) => fila.id));
      this.registros.update((actuales) => [
        ...actuales,
        ...pagina.filter((fila) => !conocidos.has(fila.id)),
      ]);
      this.hayMas.set(pagina.length === POR_PAGINA);
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudieron cargar más movimientos',
      );
    } finally {
      this.cargandoMas.set(false);
    }
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);

    try {
      const pagina = await this.reportes.actividad(POR_PAGINA, 0);
      this.registros.set(pagina);
      this.hayMas.set(pagina.length === POR_PAGINA);
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo cargar el registro de actividad',
      );
    } finally {
      this.cargando.set(false);
    }
  }

  private fecha(iso: string): string {
    const momento = new Date(iso);
    if (Number.isNaN(momento.getTime())) return '';
    return momento.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private hora(iso: string): string {
    const momento = new Date(iso);
    if (Number.isNaN(momento.getTime())) return '';
    return momento.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}
