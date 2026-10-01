import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AvisosComponent } from '../shared/components/avisos.component';

@Component({
  selector: 'app-layout-auth',
  imports: [RouterOutlet, RouterLink, AvisosComponent],
  templateUrl: './layout-auth.component.html',
  styleUrl: './layout-auth.component.scss',
})
export class LayoutAuthComponent {}
