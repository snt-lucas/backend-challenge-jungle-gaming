import { Module } from "@nestjs/common";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { PresentationModule } from "./presentation/presentation.module";
import { MessagingModule } from "./infrastructure/messaging/messaging.module";

@Module({
  imports: [
    DatabaseModule,
    PresentationModule,
    MessagingModule,
  ],
})
export class AppModule {}
