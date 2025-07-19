const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder } = require('discord.js');
const mysql = require('mysql2/promise');

// Configurações usando variáveis de ambiente
const config = {
    token: process.env.TOKEN,
    guildId: process.env.GUILD_ID,
    verifyChannelId: process.env.VERIFY_CHANNEL_ID,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
    announcementsChannelId: process.env.ANNOUNCEMENTS_CHANNEL_ID,
    roles: {
        unverified: process.env.UNVERIFIED_ROLE_ID,
        verified: process.env.VERIFIED_ROLE_ID
    },
    loadoutsPerPage: 5
};

// Configuração do banco de dados
const dbConfig = {
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE
};

class ClanBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });
        
        this.db = null;
        this.membersCache = [];
        this.loadoutsCache = [];
        this.initializeDatabase();
        this.setupEventHandlers();
        this.initializeSystems();
    }
    
    async initializeDatabase() {
        try {
            this.db = await mysql.createConnection(dbConfig);
            console.log('✅ Conectado ao banco de dados MySQL');
            await this.createTables();
            await this.updateMembersCache();
            await this.updateLoadoutsCache();
        } catch (error) {
            console.error('❌ Erro ao conectar ao banco de dados:', error);
            process.exit(1);
        }
    }
    
    async createTables() {
        try {
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS members (
                    id VARCHAR(255) PRIMARY KEY,
                    discord_id VARCHAR(255) NOT NULL,
                    game_nick VARCHAR(255) NOT NULL,
                    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE INDEX discord_id_unique (discord_id)
                )
            `);
            
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS loadouts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    weapon_name VARCHAR(255) NOT NULL,
                    weapon_code VARCHAR(255) NOT NULL,
                    weapon_image VARCHAR(255),
                    added_by VARCHAR(255) NOT NULL,
                    added_date DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('✅ Tabelas criadas/verificadas');
        } catch (error) {
            console.error('❌ Erro ao criar tabelas:', error);
        }
    }
    
    async updateMembersCache() {
        try {
            const [members] = await this.db.execute('SELECT game_nick, join_date FROM members');
            this.membersCache = members;
            console.log('🔄 Cache de membros atualizado');
        } catch (error) {
            console.error('❌ Erro ao atualizar cache de membros:', error);
        }
    }

    async updateLoadoutsCache() {
        try {
            const [loadouts] = await this.db.execute('SELECT * FROM loadouts');
            this.loadoutsCache = loadouts;
            console.log('🔄 Cache de loadouts atualizado');
        } catch (error) {
            console.error('❌ Erro ao atualizar cache de loadouts:', error);
        }
    }
    
    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('perfil')
                .setDescription('Mostra seu perfil no clã'),
            new SlashCommandBuilder()
                .setName('membros')
                .setDescription('Lista todos os membros do clã'),
            new SlashCommandBuilder()
                .setName('verificar')
                .setDescription('Inicia o processo de verificação'),
            new SlashCommandBuilder()
                .setName('addloadout')
                .setDescription('Adiciona um novo loadout')
                .addStringOption(option =>
                    option.setName('nome')
                        .setDescription('Nome da arma')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('codigo')
                        .setDescription('Código da arma')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('imagem')
                        .setDescription('URL da imagem da arma')
                        .setRequired(false)),
            new SlashCommandBuilder()
                .setName('loadouts')
                .setDescription('Lista todos os loadouts disponíveis')
        ];

        try {
            const guild = await this.client.guilds.fetch(config.guildId);
            await guild.commands.set(commands);
            console.log('Comandos slash registrados com sucesso!');
        } catch (error) {
            console.error('Erro ao registrar comandos:', error);
        }
    }
    
    setupEventHandlers() {
        this.client.on('ready', async () => {
            console.log(`Bot conectado como ${this.client.user.tag}`);
            await this.registerCommands();
            this.verificationSystem.setupVerificationChannel();
            
            setInterval(() => this.updateMembersCache(), 3600000);
            setInterval(() => this.updateLoadoutsCache(), 3600000);
        });
        
        this.client.on('guildMemberAdd', async (member) => {
            try {
                await member.roles.add(config.roles.unverified);
                this.welcomeSystem.sendWelcomeMessage(member);
            } catch (error) {
                console.error('Erro ao atribuir cargo de não verificado:', error);
            }
        });
        
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isButton()) {
                if (interaction.customId === 'verify_button') {
                    this.verificationSystem.handleVerificationStart(interaction);
                } else if (interaction.customId.startsWith('loadout_')) {
                    this.handleLoadoutPagination(interaction);
                }
            }
            
            if (interaction.isModalSubmit() && interaction.customId === 'verification_modal') {
                this.verificationSystem.handleVerificationSubmit(interaction);
            }
            
            if (interaction.isCommand()) {
                switch (interaction.commandName) {
                    case 'perfil':
                        this.showUserProfile(interaction);
                        break;
                    case 'membros':
                        this.showClanMembers(interaction);
                        break;
                    case 'verificar':
                        this.verificationSystem.handleVerificationStart(interaction);
                        break;
                    case 'addloadout':
                        this.handleAddLoadout(interaction);
                        break;
                    case 'loadouts':
                        this.showLoadouts(interaction);
                        break;
                }
            }
        });
    }
    
    async showUserProfile(interaction) {
        try {
            const [memberData] = await this.db.execute(
                'SELECT game_nick, join_date FROM members WHERE discord_id = ?',
                [interaction.user.id]
            );
            
            if (!memberData[0]) {
                return interaction.reply({ 
                    content: 'Você não está registrado no sistema do clã. Por favor, complete a verificação.', 
                    ephemeral: true 
                });
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`Perfil de ${memberData[0].game_nick}`)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: 'Membro desde', value: new Date(memberData[0].join_date).toLocaleDateString('pt-BR'), inline: false }
                )
                .setColor('#6495ED');
                
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao mostrar perfil:', error);
            await interaction.reply({ 
                content: 'Ocorreu um erro ao carregar seu perfil.', 
                ephemeral: true 
            });
        }
    }
    
    async showClanMembers(interaction) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('Membros do Clã')
                .setColor('#6495ED');
                
            if (this.membersCache.length === 0) {
                embed.setDescription('Nenhum membro cadastrado ainda.');
            } else {
                this.membersCache.forEach(member => {
                    embed.addFields({
                        name: member.game_nick,
                        value: `Membro desde: ${new Date(member.join_date).toLocaleDateString('pt-BR')}`,
                        inline: true
                    });
                });
            }
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao mostrar membros:', error);
            await interaction.reply({ 
                content: 'Ocorreu um erro ao carregar a lista de membros.', 
                ephemeral: true 
            });
        }
    }

    async handleAddLoadout(interaction) {
        const weaponName = interaction.options.getString('nome');
        const weaponCode = interaction.options.getString('codigo');
        const weaponImage = interaction.options.getString('imagem') || null;
        const addedBy = interaction.user.tag;

        try {
            await this.db.execute(
                'INSERT INTO loadouts (weapon_name, weapon_code, weapon_image, added_by) VALUES (?, ?, ?, ?)',
                [weaponName, weaponCode, weaponImage, addedBy]
            );

            await this.updateLoadoutsCache();
            
            const embed = new EmbedBuilder()
                .setTitle('Loadout Adicionado')
                .setDescription(`O loadout **${weaponName}** foi adicionado com sucesso!`)
                .addFields(
                    { name: 'Código', value: `\`\`\`${weaponCode}\`\`\``, inline: false }
                )
                .setColor('#00FF00');
                
            if (weaponImage) {
                embed.setImage(weaponImage);
            }

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao adicionar loadout:', error);
            await interaction.reply({ 
                content: 'Ocorreu um erro ao adicionar o loadout.', 
                ephemeral: true 
            });
        }
    }

    async showLoadouts(interaction, page = 0) {
        try {
            const loadouts = this.loadoutsCache;
            const totalPages = Math.ceil(loadouts.length / config.loadoutsPerPage);
            
            if (loadouts.length === 0) {
                return interaction.reply({ 
                    content: 'Nenhum loadout cadastrado ainda.', 
                    ephemeral: true 
                });
            }

            const currentLoadouts = loadouts.slice(
                page * config.loadoutsPerPage,
                (page + 1) * config.loadoutsPerPage
            );

            const embed = new EmbedBuilder()
                .setTitle('📜 Lista de Loadouts')
                .setDescription(`Página ${page + 1} de ${totalPages}`)
                .setColor('#6495ED');

            currentLoadouts.forEach(loadout => {
                embed.addFields(
                    { name: loadout.weapon_name, value: `Código: \`${loadout.weapon_code}\`\nAdicionado por: ${loadout.added_by}`, inline: false }
                );
                
                if (loadout.weapon_image) {
                    embed.setImage(loadout.weapon_image);
                }
            });

            const row = new ActionRowBuilder();
            
            if (page > 0) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`loadout_prev_${page}`)
                        .setLabel('⬅️ Anterior')
                        .setStyle(ButtonStyle.Primary)
                );
            }
            
            if (page < totalPages - 1) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`loadout_next_${page}`)
                        .setLabel('Próximo ➡️')
                        .setStyle(ButtonStyle.Primary)
                );
            }

            const replyOptions = { embeds: [embed] };
            if (row.components.length > 0) {
                replyOptions.components = [row];
            }

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(replyOptions);
            } else {
                await interaction.reply(replyOptions);
            }
        } catch (error) {
            console.error('Erro ao mostrar loadouts:', error);
            await interaction.reply({ 
                content: 'Ocorreu um erro ao carregar a lista de loadouts.', 
                ephemeral: true 
            });
        }
    }

    async handleLoadoutPagination(interaction) {
        const [action, page] = interaction.customId.split('_').slice(1);
        let newPage = parseInt(page);
        
        if (action === 'prev') {
            newPage--;
        } else if (action === 'next') {
            newPage++;
        }

        await this.showLoadouts(interaction, newPage);
    }
    
    initializeSystems() {
        this.verificationSystem = new VerificationSystem(this);
        this.welcomeSystem = new WelcomeSystem(this);
        this.announcementSystem = new AnnouncementSystem(this);
    }
    
    start() {
        this.client.login(config.token)
            .then(() => console.log(`🤖 Bot ${this.client.user.tag} conectado!`))
            .catch(error => {
                console.error('❌ Falha ao conectar o bot:', error);
                process.exit(1);
            });
    }
}

class VerificationSystem {
    constructor(bot) {
        this.bot = bot;
    }
    
    async setupVerificationChannel() {
        const guild = await this.bot.client.guilds.fetch(config.guildId);
        const channel = await guild.channels.fetch(config.verifyChannelId);
        
        if (!channel) return;
        
        const messages = await channel.messages.fetch();
        await channel.bulkDelete(messages);
        
        const embed = new EmbedBuilder()
            .setTitle('Verificação de Membro')
            .setDescription('Para acessar o servidor, você precisa se verificar.\n\nClique no botão abaixo e insira seu nickname do jogo no formato **WFxSeuNick**.')
            .setColor('#6495ED');
            
        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_button')
                .setLabel('Verificar-se')
                .setStyle(ButtonStyle.Primary)
        );
        
        await channel.send({ embeds: [embed], components: [button] });
    }
    
    async handleVerificationStart(interaction) {
        const member = interaction.member;
        if (member.roles.cache.has(config.roles.verified)) {
            return interaction.reply({ content: 'Você já está verificado!', ephemeral: true });
        }
        
        const modal = new ModalBuilder()
            .setCustomId('verification_modal')
            .setTitle('Verificação de Nickname');
            
        const nicknameInput = new TextInputBuilder()
            .setCustomId('nickname_input')
            .setLabel("Insira seu nickname no formato WFxSeuNick")
            .setStyle(TextInputStyle.Short)
            .setMinLength(5)
            .setMaxLength(20)
            .setRequired(true);
            
        const actionRow = new ActionRowBuilder().addComponents(nicknameInput);
        modal.addComponents(actionRow);
        
        await interaction.showModal(modal);
    }
    
    async handleVerificationSubmit(interaction) {
        const nickname = interaction.fields.getTextInputValue('nickname_input');
        const member = interaction.member;
        
        if (!nickname.startsWith('WFx') || nickname.length < 5) {
            return interaction.reply({ 
                content: 'Nickname inválido! Por favor, use o formato WFxSeuNick (ex: WFxPlayer123).', 
                ephemeral: true 
            });
        }
        
        try {
            await member.setNickname(nickname);
            await member.roles.add(config.roles.verified);
            await member.roles.remove(config.roles.unverified);
            
            await this.bot.db.execute(
                'INSERT INTO members (discord_id, game_nick) VALUES (?, ?) ON DUPLICATE KEY UPDATE game_nick = ?',
                [member.id, nickname, nickname]
            );
            
            await interaction.reply({ 
                content: `Verificação concluída com sucesso! Seu nickname foi definido como ${nickname}.`, 
                ephemeral: true 
            });
            
            this.bot.welcomeSystem.sendWelcomeDM(member);
            await this.bot.updateMembersCache();
        } catch (error) {
            console.error('Erro na verificação:', error);
            await interaction.reply({ 
                content: 'Ocorreu um erro durante a verificação. Por favor, tente novamente ou contate um administrador.', 
                ephemeral: true 
            });
        }
    }
}

class WelcomeSystem {
    constructor(bot) {
        this.bot = bot;
    }
    
    async sendWelcomeMessage(member) {
        const guild = await this.bot.client.guilds.fetch(config.guildId);
        const channel = await guild.channels.fetch(config.welcomeChannelId);
        
        if (!channel) return;
        
        const embed = new EmbedBuilder()
            .setTitle(`Bem-vindo(a) ao servidor, ${member.user.username}!`)
            .setDescription('Por favor, vá até o canal de verificação para acessar todos os recursos do servidor.')
            .setThumbnail(member.user.displayAvatarURL())
            .setColor('#25D366')
            .setTimestamp();
            
        await channel.send({ embeds: [embed] });
    }
    
    async sendWelcomeDM(member) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('🎉 Bem-vindo(a) ao nosso servidor! 🎉')
                .setDescription(`
                    Agora que você está verificado, aqui estão algumas coisas que você pode fazer:
                    
                    - Ver seu perfil com \`/perfil\`
                    - Ver os membros do clã com \`/membros\`
                    - Adicionar loadouts com \`/addloadout\`
                    - Ver loadouts com \`/loadouts\`
                    
                    Divirta-se e boa jogatina!
                `)
                .setColor('#25D366');
                
            await member.send({ embeds: [embed] });
        } catch (error) {
            console.error('Não foi possível enviar mensagem de boas-vindas via DM:', error);
        }
    }
}

class AnnouncementSystem {
    constructor(bot) {
        this.bot = bot;
    }
    
    async sendAnnouncement(title, description, author) {
        const channel = await this.bot.client.channels.fetch(config.announcementsChannelId);
        if (!channel) return;
        
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor('#FF9900')
            .setFooter({ text: `Anúncio enviado por ${author}` })
            .setTimestamp();
            
        await channel.send({ embeds: [embed] });
    }
}

const bot = new ClanBot();
bot.start();

// Tratamento de encerramento gracioso
process.on('SIGINT', () => {
    console.log('🛑 Encerrando bot...');
    bot.client.destroy();
    process.exit();
});
