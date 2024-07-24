import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import {
  ChangeOrderStatusDto,
  CreateOrderDto,
  OrderPaginationDto,
} from './dto';
import { NATS_SERVICE } from 'src/config';
import { OrderWithProducts } from './interfaces/order-with-products.interface';
import { PaidOrderDto } from './dto/paid-order.dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('OrdersService');

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected!!');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds),
      );
      console.log(products);

      const totalAmount = createOrderDto.items.reduce((_, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId,
        ).price;
        return price * orderItem.quantity;
      }, 0);
      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          orderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                productId: orderItem.productId,
                quantity: orderItem.quantity,
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
              })),
            },
          },
        },
        include: {
          orderItem: {
            select: { price: true, quantity: true, productId: true },
          },
        },
      });

      return {
        ...order,
        orderItem: order.orderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId)
            .name,
        })),
      };
    } catch (err) {
      console.log(err);
      // throw new RpcException({
      //   status: HttpStatus.BAD_REQUEST,
      //   message: 'Check logs',
      // });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto;
    const totalPages = await this.order.count({ where: { status } });
    const lastPage = Math.ceil(totalPages / limit);
    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: { status },
      }),
      meta: {
        total: totalPages,
        page: page,
        lastPage: lastPage,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        orderItem: { select: { price: true, quantity: true, productId: true } },
      },
    });
    if (!order)
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id #${id} not found`,
      });
    const productIds = order.orderItem.map((orderItem) => orderItem.productId);
    const products = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds),
    );
    return {
      ...order,
      orderItem: order.orderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId)
          .name,
      })),
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;
    const order = await this.findOne(id);
    if (order.status === status) return order;
    return this.order.update({ where: { id }, data: { status } });
  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.orderItem.map((item) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
      }),
    );
    return paymentSession;
  }

  async paidOrder(paidOrderDto: PaidOrderDto) {
    this.logger.log('Paid order');

    const order = await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,
        orderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl,
          },
        },
      },
    });

    return order;
  }
}
