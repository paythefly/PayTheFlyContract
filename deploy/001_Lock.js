module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Set unlock time (1 hour from now)
  const unlockTime = Math.floor(Date.now() / 1000) + 3600;

  console.log("Deploying Lock with deployer:", deployer);

  const lock = await deploy("Lock", {
    from: deployer,
    args: [unlockTime],
    value: "1000000", // 1 TRX in sun
    log: true,
  });

  console.log("Lock deployed to:", lock.address);
};

module.exports.tags = ["Lock"];
